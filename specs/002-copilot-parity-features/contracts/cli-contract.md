# CLI Contract: Copilot Parity Features

**Date**: 2025-07-25 | **Plan**: [../plan.md](../plan.md)

## 1. `copilot` Command (profile extension)

### Synopsis

```
npx mcp-automem copilot [--profile <lean|extras>] [--dir <path>] [--dry-run] [--yes] [--quiet]
```

### Flags

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--profile` | `lean \| extras` | `lean` | Hook profile to install |
| `--dir` | `string` | `~/.copilot` | Target directory for hooks and scripts |
| `--dry-run` | `boolean` | `false` | Show planned changes without modifying files |
| `--yes` / `-y` | `boolean` | `false` | Skip confirmation prompts |
| `--quiet` | `boolean` | `false` | Suppress non-error output |

### Exit Codes

| Code | Meaning |
|------|---------|
| `0` | Success (or dry-run completed) |
| `1` | Invalid profile name or other argument error |

### Behavior

- Invalid `--profile` value: prints error listing valid profiles, exits 1
- Re-run with different profile: remove-first strategy (delete hooks not in target profile, then install target set)
- Partial failure during profile switch: safe degradation (fewer hooks, not stale hooks)

---

## 2. `uninstall copilot` Command

### Synopsis

```
npx mcp-automem uninstall copilot [--dir <path>] [--clean-all] [--dry-run] [--yes] [--quiet]
```

### Flags

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--dir` | `string` | `~/.copilot` | Target directory for hooks/scripts |
| `--clean-all` | `boolean` | `false` | Also remove MCP server config |
| `--dry-run` | `boolean` | `false` | List files that would be removed |
| `--yes` / `-y` | `boolean` | `false` | Skip confirmation |
| `--quiet` | `boolean` | `false` | Suppress non-error output |

### Exit Codes

| Code | Meaning |
|------|---------|
| `0` | Success (including "nothing to remove") |
| `1` | Argument parsing error |

### Removed Artifacts

1. All `automem-*.json` files from `{dir}/hooks/`
2. All AutoMem `.sh` and `.ps1` scripts from `{dir}/scripts/`
3. (with `--clean-all`) AutoMem entry from `{dir}/mcp-config.json`
4. Backups created for each removed file as `{file}.removed.{timestamp}`

### Output (non-quiet)

```
🚮 AutoMem Uninstaller
   Platform: copilot

🗑️  Removed: ~/.copilot/hooks/automem-session-start.json
   Backup: ~/.copilot/hooks/automem-session-start.json.removed.1737820800000
🗑️  Removed: ~/.copilot/hooks/automem-session-end.json
   ...
🗑️  Removed: ~/.copilot/scripts/capture-build-result.sh
   ...

✅ Removed N AutoMem files from Copilot hooks directory

✨ Uninstall complete!
```

---

## 3. `migrate --to copilot` / `--from copilot`

### Synopsis

```
npx mcp-automem migrate --from <manual|none|copilot> --to <cursor|claude-code|copilot> [--dir <path>] [--dry-run] [--yes] [--quiet]
```

### Extended Values

| Flag | Added Values |
|------|-------------|
| `--from` | `copilot` (added alongside existing `manual`, `none`) |
| `--to` | `copilot` (added alongside existing `cursor`, `claude-code`) |

### Exit Codes

| Code | Meaning |
|------|---------|
| `0` | Success |
| `1` | Missing or invalid `--from`/`--to` arguments |

### Behavior

- `--to copilot`: delegates to the copilot installer (same code path as `npx mcp-automem copilot`)
- `--from copilot`: analyzes existing copilot hooks, then installs target platform
- Forwards `--dry-run`, `--yes`, `--quiet` to the underlying installer

---

## 4. PowerShell Script Contract

All `.ps1` scripts share this contract:

### Invocation

```
powershell -ExecutionPolicy Bypass -File <script-path>
```

### Input

- Stdin: JSON object with hook context (same as bash scripts receive)
- Environment variables: same as bash scripts (`CLAUDE_LAST_COMMAND`, `CLAUDE_COMMAND_OUTPUT`, etc. - adapted for Copilot equivalents)

### Output

- Stdout: brief status message (e.g., "Build failure captured for analysis")
- Stderr: error messages (for debugging only)

### Exit Code

- Always `0` - scripts MUST NOT block user workflow
- Errors logged to stderr, then exit 0

### Queue Format

Appends single JSONL line to `~/.copilot/scripts/memory-queue.jsonl`:

```json
{"content":"Build succeeded in myproject using npm (time: 2.3s)","tags":["build","npm","typescript","myproject"],"importance":0.5,"type":"Context","metadata":{"build_tool":"npm","exit_code":0,"project":"myproject"},"timestamp":"2025-07-25T12:00:00.000Z"}
```

### Scripts Delivered

| Script | Bash Equivalent | Purpose |
|--------|----------------|---------|
| `capture-build-result.ps1` | `capture-build-result.sh` | Record build outcomes |
| `capture-test-pattern.ps1` | `capture-test-pattern.sh` | Record test results |
| `capture-deployment.ps1` | `capture-deployment.sh` | Record deployment events |
| `session-memory.ps1` | `session-memory.sh` | Process session context at end |
| `queue-cleanup.ps1` | `queue-cleanup.sh` | Deduplicate and archive queue |
| `python-command.ps1` | `python-command.sh` | Locate Python executable |
