# CLI Interface Contract: `copilot` Command

**Feature**: 001-copilot-cli-setup | **Date**: 2025-07-24

## Command Signature

```
npx @verygoodplugins/mcp-automem copilot [options]
```

## Options

| Flag | Alias | Type | Default | Description |
|---|---|---|---|---|
| `--format` | | `cli \| vscode` | `cli` | Event name casing in hook JSON files. `cli` = camelCase, `vscode` = PascalCase. Either format works for both surfaces. See https://docs.github.com/en/copilot/reference/hooks-reference |
| `--dir` | | `<path>` | `~/.copilot` | Target installation directory |
| `--dry-run` | | boolean | `false` | Preview file operations without writing to disk |
| `--yes` | `-y` | boolean | `false` | Skip interactive confirmation prompts |
| `--quiet` | | boolean | `false` | Suppress non-error output |

## Exit Codes

| Code | Meaning |
|---|---|
| 0 | Success (or dry-run completed) |
| 1 | Invalid arguments (e.g., bad `--format` value) |
| 1 | Permission error (cannot write to target directory) |
| 1 | Template file missing (package integrity issue) |

## Output Contract

### Normal Execution (`--yes`, no `--quiet`)

```
Configuring Copilot in ~/.copilot

installed hook: automem-session-start.json
installed hook: automem-post-tool-use.json
installed hook: automem-session-end.json
installed script: capture-build-result.sh
installed script: capture-test-pattern.sh
installed script: capture-deployment.sh
installed script: session-memory.sh
installed script: python-command.sh
installed script: queue-cleanup.sh
installed script: process-session-memory.py

✓ Hook JSON files installed for automatic memory capture
✓ Support scripts installed for queue processing

Next steps:
1. Add MCP server to Copilot config (see INSTALLATION.md)
2. Add memory rules: cat templates/COPILOT_INSTRUCTIONS_MEMORY_RULES.md >> ~/.copilot/copilot-instructions.md
3. Restart Copilot
```

### Dry-Run Execution (`--dry-run`)

```
Configuring Copilot in ~/.copilot (dry run)

dry-run: would write ~/.copilot/hooks/automem-session-start.json
dry-run: would write ~/.copilot/hooks/automem-post-tool-use.json
dry-run: would write ~/.copilot/hooks/automem-session-end.json
dry-run: would write ~/.copilot/scripts/capture-build-result.sh
...
```

### Backup Notification (when overwriting existing files)

```
backup created: ~/.copilot/hooks/automem-session-start.json.bak
installed hook: automem-session-start.json
```

### Error: Invalid Format

```
Error: Invalid format 'foo'. Valid options: cli, vscode
```

## Files Created

All paths relative to `<targetDir>` (default `~/.copilot`):

```
<targetDir>/
├── hooks/
│   ├── automem-session-start.json    # Hook JSON (prompt type)
│   ├── automem-post-tool-use.json    # Hook JSON (command type)
│   └── automem-session-end.json      # Hook JSON (command type)
└── scripts/
    ├── automem-session-start.sh      # Memory recall prompt (reference)
    ├── capture-build-result.sh       # Build event capture
    ├── capture-test-pattern.sh       # Test event capture
    ├── capture-deployment.sh         # Deploy event capture
    ├── session-memory.sh             # Session-end memory capture
    ├── python-command.sh             # Python resolver utility
    ├── queue-cleanup.sh              # Queue deduplication
    ├── process-session-memory.py     # Python session processor
    └── memory-filters.json           # Filter configuration
```

## Exported API

```typescript
// src/cli/copilot.ts

export interface CopilotSetupOptions {
  targetDir?: string;
  format?: 'cli' | 'vscode';
  dryRun?: boolean;
  yes?: boolean;
  quiet?: boolean;
}

/** Apply Copilot setup with resolved options. Called by runCopilotSetup or programmatically. */
export async function applyCopilotSetup(options: CopilotSetupOptions): Promise<void>;

/** Parse CLI args and run setup. Entry point from src/index.ts command routing. */
export async function runCopilotSetup(args?: string[]): Promise<void>;
```

## Registration

In `src/index.ts`:
```typescript
import { runCopilotSetup } from './cli/copilot.js';

// In help text, add:
//   copilot            Set up AutoMem for GitHub Copilot

// In command routing, add:
if (command === 'copilot') {
  await runCopilotSetup(process.argv.slice(3));
  process.exit(0);
}
```
