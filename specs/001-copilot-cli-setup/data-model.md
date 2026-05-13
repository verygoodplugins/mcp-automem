# Data Model: Copilot CLI Setup Command

**Feature**: 001-copilot-cli-setup | **Date**: 2025-07-24

## Entities

### 1. CopilotSetupOptions

TypeScript interface for CLI argument parsing. Extends the pattern from `ClaudeCodeSetupOptions` in `src/cli/claude-code.ts`.

```typescript
interface CopilotSetupOptions {
  targetDir?: string;   // --dir flag, default: ~/.copilot
  format?: 'cli' | 'vscode'; // --format flag, default: 'cli'
  dryRun?: boolean;     // --dry-run flag
  yes?: boolean;        // --yes / -y flag
  quiet?: boolean;      // --quiet flag
}
```

**Validation rules**:
- `format` must be `'cli'` or `'vscode'`; invalid values produce error + exit code 1
- `targetDir` defaults to `path.join(os.homedir(), '.copilot')`
- `format` defaults to `'cli'`

### 2. Hook JSON File (Copilot v1 format)

Standalone JSON files installed into `<targetDir>/hooks/`. Each file follows Copilot's hook configuration format.

```typescript
interface CopilotHookFile {
  version: 1;
  hooks: Record<string, CopilotHookEntry[]>;
}

interface CopilotHookEntry {
  type: 'command' | 'prompt' | 'http';
  bash?: string;         // Shell command for Unix
  powershell?: string;   // Shell command for Windows
  command?: string;      // Cross-platform fallback
  prompt?: string;       // For type: 'prompt' only
  cwd?: string;
  env?: Record<string, string>;
  timeoutSec?: number;
}
```

**Files produced**:

| Filename | Event Key (cli) | Event Key (vscode) | Hook Type |
|---|---|---|---|
| `automem-session-start.json` | `sessionStart` | `SessionStart` | `prompt` |
| `automem-post-tool-use.json` | `postToolUse` | `PostToolUse` | `command` |
| `automem-session-end.json` | `sessionEnd` | `SessionEnd` | `command` |

### 3. Event Name Map

Controls the casing of event names in generated hook JSON based on `--format`.

```typescript
const EVENT_NAMES = {
  cli: {
    sessionStart: 'sessionStart',
    postToolUse: 'postToolUse',
    sessionEnd: 'sessionEnd',
  },
  vscode: {
    sessionStart: 'SessionStart',
    postToolUse: 'PostToolUse',
    sessionEnd: 'SessionEnd',
  },
} as const;
```

### 4. Support Script

Shell scripts installed into `<targetDir>/scripts/`. Adapted from `templates/claude-code/scripts/` with:
- Path references changed from `~/.claude/` to `~/.copilot/`
- Stdin JSON parsing added at entry point

| Script | Purpose | Executable |
|---|---|---|
| `automem-session-start.sh` | Memory recall prompt text (for reference/debugging) | Yes (0755) |
| `capture-build-result.sh` | Captures build outcomes from postToolUse stdin | Yes (0755) |
| `capture-test-pattern.sh` | Captures test run results from postToolUse stdin | Yes (0755) |
| `capture-deployment.sh` | Captures deployment events from postToolUse stdin | Yes (0755) |
| `session-memory.sh` | Captures session-end context, queues memory | Yes (0755) |
| `python-command.sh` | Python version resolver (shared utility) | Yes (0755) |
| `queue-cleanup.sh` | Deduplicates/archives queue | Yes (0755) |
| `process-session-memory.py` | Python session memory processor | Yes (0755) |
| `memory-filters.json` | Filter configuration for memory significance | No (default perms) |

### 5. Memory Rules Template

Markdown file at `templates/COPILOT_INSTRUCTIONS_MEMORY_RULES.md`. Adapted from `templates/CLAUDE_MD_MEMORY_RULES.md` with:
- Tool naming: `mcp_<server>_<tool>` (VS Code) and `<server>-<tool>` (Copilot CLI)
- References to `~/.copilot/copilot-instructions.md` instead of `~/.claude/CLAUDE.md`
- Copilot-specific recall and store examples

### 6. Memory Queue Entry

The JSONL queue format is unchanged from Claude Code. Scripts append entries to `<targetDir>/scripts/memory-queue.jsonl`:

```typescript
interface MemoryQueueEntry {
  content: string;
  tags: string[];
  importance: number;
  timestamp: string;       // ISO 8601 UTC
  metadata?: Record<string, unknown>;
  relatesTo?: string;      // Optional memory ID for association
}
```

## Relationships

```
CopilotSetupOptions
  └──> generates Hook JSON Files (3 files into hooks/)
  └──> installs Support Scripts (9 files into scripts/)
  └──> references Memory Rules Template (1 file in templates/)

Hook JSON Files
  └──> reference Support Scripts (via bash/powershell command paths)

Support Scripts
  └──> append to Memory Queue (JSONL file in scripts/)

Memory Queue
  └──> drained by `npx mcp-automem queue` (existing, unchanged)
```

## State Transitions

### Installation State

```
NOT_INSTALLED
  ├── [run copilot --yes] ──> INSTALLED (all files created)
  ├── [run copilot --dry-run] ──> NOT_INSTALLED (preview only)
  └── [target exists] ──> BACKUP_THEN_INSTALL (.bak created, then overwritten)
```

No runtime state machine - the installer is a one-shot file writer.
