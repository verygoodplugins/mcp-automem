# Data Model: Copilot Parity Features

**Date**: 2025-07-25 | **Plan**: [plan.md](plan.md)

## Entities

### 1. Hook Profile

A named set of hook JSON filenames that determines which events trigger memory capture.

| Field | Type | Description |
|-------|------|-------------|
| `name` | `string` | Profile identifier (`lean` or `extras`) |
| `hooks` | `string[]` | List of hook JSON filenames to install (e.g., `["automem-session-start.json"]`) |

**Validation rules**:
- `name` must be one of `lean` or `extras` (validated at CLI argument parsing)
- `hooks` must be non-empty and reference files that exist in `templates/copilot/hooks/`
- Default profile is `lean` when `--profile` flag is omitted

**State transitions**:
- `no-profile` -> `lean` (first install with default)
- `no-profile` -> `extras` (first install with `--profile extras`)
- `lean` -> `extras` (re-run with `--profile extras`; remove-first strategy)
- `extras` -> `lean` (re-run with `--profile lean`; remove-first strategy)

### 2. UninstallOptions (extended)

The existing interface in `src/cli/uninstall.ts`, extended with `copilot`.

| Field | Type | Change |
|-------|------|--------|
| `platform` | `'cursor' \| 'claude-code' \| 'copilot'` | **MODIFIED** - add `copilot` to union |
| `projectDir` | `string?` | Unchanged |
| `cleanAll` | `boolean?` | Unchanged |
| `dryRun` | `boolean?` | Unchanged |
| `yes` | `boolean?` | Unchanged |
| `quiet` | `boolean?` | Unchanged |

### 3. MigrateOptions (extended)

The existing interface in `src/cli/migrate.ts`, extended with `copilot`.

| Field | Type | Change |
|-------|------|--------|
| `from` | `'manual' \| 'none' \| 'copilot'` | **MODIFIED** - add `copilot` |
| `to` | `'cursor' \| 'claude-code' \| 'copilot'` | **MODIFIED** - add `copilot` |
| `projectDir` | `string?` | Unchanged |
| `dryRun` | `boolean?` | Unchanged |
| `yes` | `boolean?` | Unchanged |
| `quiet` | `boolean?` | Unchanged |

### 4. Hook JSON File

A standalone JSON file placed in `~/.copilot/hooks/` that configures a single hook trigger. Structure defined by Copilot CLI.

| Field | Type | Description |
|-------|------|-------------|
| `event` | `string` | Hook event type (e.g., `session_start`, `post_tool_use`, `session_end`) |
| `command` | `string` | Bash command to execute |
| `powershell` | `string` | PowerShell command: `powershell -ExecutionPolicy Bypass -File <script>` |
| `matcher` | `string?` | Optional tool matcher for post_tool_use hooks |

**Naming convention**: All AutoMem hook files use `automem-` prefix (e.g., `automem-session-start.json`, `automem-build.json`).

### 5. JSONL Queue Entry

A single line in `~/.copilot/scripts/memory-queue.jsonl`. Same schema as claude-code queue entries.

| Field | Type | Description |
|-------|------|-------------|
| `content` | `string` | Memory content text (max 1500 chars) |
| `tags` | `string[]` | Bare tags (e.g., `["build", "npm", "typescript"]`) |
| `importance` | `number` | 0.0-1.0 importance score |
| `type` | `string` | Memory type (`Context`, `Insight`, `Pattern`) |
| `metadata` | `object` | Script-specific metadata (build_tool, exit_code, etc.) |
| `timestamp` | `string` | ISO 8601 UTC timestamp |

### 6. Profile Definition File

JSON file at `templates/copilot/profiles/{name}.json`.

```json
{
  "name": "lean",
  "description": "Minimal hooks - session start and end only",
  "hooks": [
    "automem-session-start.json",
    "automem-session-end.json"
  ]
}
```

```json
{
  "name": "extras",
  "description": "Full hook set including build, test, and deploy capture",
  "hooks": [
    "automem-session-start.json",
    "automem-build.json",
    "automem-test.json",
    "automem-deploy.json",
    "automem-session-end.json"
  ]
}
```

## Relationships

```
Profile --selects--> Hook JSON Files --references--> Support Scripts (.sh + .ps1)
                                                          |
                                                          v
                                                   JSONL Queue Entry
                                                          |
                                                          v
                                              `npx mcp-automem queue` (drain)
```

- A **Profile** determines which **Hook JSON Files** are installed
- Each **Hook JSON File** references both a bash and PowerShell **Support Script**
- Each **Support Script** appends **JSONL Queue Entries** to the queue file
- The queue is drained at session end by `npx mcp-automem queue`
- **Uninstall** removes Hook JSON Files + Support Scripts + optionally MCP config
- **Migrate** analyzes source state then delegates to the copilot installer
