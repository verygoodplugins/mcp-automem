# Research: Copilot CLI Setup Command

**Feature**: 001-copilot-cli-setup | **Date**: 2025-07-24

## R1: Copilot Hook JSON File Format (version 1)

**Decision**: Use standalone JSON files with `version: 1` and a `hooks` object keyed by event name.

**Rationale**: The Copilot hooks reference (https://docs.github.com/en/copilot/reference/hooks-reference) documents that hook configuration files use JSON format with version `1`. Each file contains a `hooks` object where keys are event names and values are arrays of hook entries. Files are loaded from `~/.copilot/hooks/*.json` (user-level) and combined - when the same event appears in multiple files, all entries from all sources are run.

**Format**:
```json
{
  "version": 1,
  "hooks": {
    "sessionStart": [
      {
        "type": "command",
        "bash": "bash script.sh",
        "powershell": "powershell script.ps1",
        "timeoutSec": 30
      }
    ]
  }
}
```

**Alternatives considered**:
- Merging into `~/.copilot/settings.json` (like claude-code.ts does) - Rejected because Copilot hooks are standalone JSON files, not embedded in settings.json. The settings.json `hooks` field is also supported but standalone files are cleaner and avoid merge conflicts.
- Single combined hook file - Rejected because one-file-per-event-group is easier to manage, update, and selectively disable.

## R2: Event Name Casing (CLI vs VS Code)

**Decision**: Default to camelCase event names (`sessionStart`, `postToolUse`, `sessionEnd`). Support `--format vscode` for PascalCase (`SessionStart`, `PostToolUse`, `SessionEnd`).

**Rationale**: Per the hooks reference, two payload formats are supported, selected by the event name casing:
- **camelCase** (`sessionStart`) - Fields use camelCase. This is the native Copilot CLI format.
- **PascalCase** (`SessionStart`) - Fields use snake_case. This matches the VS Code Copilot extension format.

Both formats work in both surfaces. The format choice affects the JSON payload structure delivered on stdin. Default to CLI (camelCase) since our scripts parse stdin JSON and need to know which field names to expect.

**Key mapping**:
| CLI (camelCase) | VS Code (PascalCase) |
|---|---|
| `sessionStart` | `SessionStart` |
| `postToolUse` | `PostToolUse` |
| `sessionEnd` | `SessionEnd` |

Note: The spec says "session end" maps to `sessionEnd`, but the hooks reference shows the agent-stop event is `agentStop` (camelCase) / `Stop` (PascalCase). The `sessionEnd` event fires when the session terminates. We need BOTH: `sessionEnd` for queue drain and `agentStop`/`Stop` for session memory capture. However, per the spec (FR-003), we target three event groups: session start, post-tool-use, and session end. The session-end hook file can include both `sessionEnd` and `agentStop` events since a single JSON file can define hooks for multiple events.

**Alternatives considered**:
- Always PascalCase - Rejected because camelCase is the native Copilot CLI format and the primary audience.
- Auto-detect format - Rejected because there's no reliable way to detect which surface the user runs.

## R3: Stdin JSON Payload Handling

**Decision**: Adapt support scripts to read JSON from stdin instead of environment variables.

**Rationale**: Claude Code hooks receive context via environment variables (`CLAUDE_LAST_COMMAND`, `CLAUDE_COMMAND_OUTPUT`, `CLAUDE_EXIT_CODE`, etc.). Copilot hooks receive a JSON payload on stdin. The payload structure depends on the event and the casing format chosen.

For `postToolUse` (camelCase), the stdin payload includes:
```json
{
  "sessionId": "string",
  "timestamp": 12345,
  "cwd": "string",
  "toolName": "string",
  "toolArgs": {},
  "toolResult": {
    "resultType": "success",
    "textResultForLlm": "string"
  }
}
```

Scripts must:
1. Read stdin into a variable
2. Parse JSON to extract relevant fields
3. Use `jq` or Python for JSON parsing (both already available in the existing script ecosystem)

**Alternatives considered**:
- Pass stdin through as-is to the memory queue - Rejected because we need to filter by tool name (bash/powershell matchers for builds/tests/deploys) and format the data for the memory queue JSONL format.
- Use `env` field in hook JSON to pass vars - Rejected because the env field only supports static values and variable expansion, not dynamic data from the hook payload.

## R4: Hook File Naming and Event Mapping

**Decision**: Three hook JSON files with automem-prefixed names mapping to these events:

| File | Events (CLI format) | Events (VS Code format) |
|---|---|---|
| `automem-session-start.json` | `sessionStart` | `SessionStart` |
| `automem-post-tool-use.json` | `postToolUse` | `PostToolUse` |
| `automem-session-end.json` | `sessionEnd` | `SessionEnd` |

**Rationale**: Per FR-002, files must use automem-prefixed names. Per the hooks reference, Copilot loads all `*.json` files from the hooks directory and merges them. Using automem-prefixed names avoids collision with hooks from other tools. One file per event group keeps the installation modular.

The `automem-session-end.json` hook handles queue drain and session memory capture at session end. Unlike Claude Code which uses separate `Stop` and `SessionEnd` events via settings.json merge, Copilot's standalone file format lets us define multiple hook entries for the `sessionEnd` event in one file.

**Alternatives considered**:
- Generic names (`session-start.json`) - Rejected per FR-002 requiring automem prefix.
- Single combined file (`automem-hooks.json`) - Viable but harder to selectively disable individual event groups.

## R5: Support Script Adaptation Strategy

**Decision**: Copy and adapt existing claude-code scripts with these changes:
1. Replace `$HOME/.claude/` paths with `$HOME/.copilot/`
2. Add stdin JSON parsing at script entry (read stdin, extract fields via jq/python)
3. Map Copilot JSON fields to the existing AUTOMEM_* environment variable names used by downstream processing

**Rationale**: The existing scripts (`session-memory.sh`, `capture-build-result.sh`, etc.) contain battle-tested logic for git context gathering, memory filtering, and queue management. The core logic is identical - only the input mechanism (stdin JSON vs env vars) and file paths differ.

The adaptation approach creates a thin stdin-parsing wrapper at the top of each script that sets the same AUTOMEM_* env vars the rest of the script already uses. This minimizes divergence and keeps both codepaths maintainable.

**Alternatives considered**:
- Shared script library with platform flag - Rejected as premature abstraction; the two platforms have meaningfully different input mechanisms.
- TypeScript-only scripts (no bash) - Rejected because hook commands must be shell commands per Copilot's hook format.

## R6: SessionStart Hook Type (Prompt vs Command)

**Decision**: Use a `prompt` type hook for `sessionStart`, not a `command` type.

**Rationale**: The existing claude-code `automem-session-start.sh` outputs a prompt that tells Claude to run memory recall phases. In Copilot, the `sessionStart` event supports `prompt` type hooks that "auto-submit text as if the user typed it." This is the ideal mechanism for injecting the memory recall prompt.

A `prompt` hook is simpler and more reliable than a `command` hook that outputs text to stdout (which would need to be parsed as `additionalContext`). The prompt hook directly injects the recall instructions into the session.

**Format**:
```json
{
  "version": 1,
  "hooks": {
    "sessionStart": [
      {
        "type": "prompt",
        "prompt": "... memory recall instructions ..."
      }
    ]
  }
}
```

**Alternatives considered**:
- Command hook that outputs to stdout - Viable but more complex; requires the script output to be captured as `additionalContext`. The `prompt` type is purpose-built for this use case.

## R7: Memory Rules Template

**Decision**: Create `templates/COPILOT_INSTRUCTIONS_MEMORY_RULES.md` adapted from `templates/CLAUDE_MD_MEMORY_RULES.md` with Copilot-specific tool naming.

**Rationale**: Per FR-012, the template must be adapted for Copilot tool naming conventions. In Copilot, MCP tools are exposed as `mcp_<server>_<tool>` (VS Code) or `<server>-<tool>` (CLI). The template should reference both naming patterns and explain the difference.

The template is NOT auto-installed into `copilot-instructions.md` (per spec: out of scope). The installer prints instructions for manual appending.

**Alternatives considered**:
- Auto-append to copilot-instructions.md - Rejected per spec: "the installer only provides a template and instructions."
- Reuse the Claude template as-is - Rejected because tool naming conventions differ between Claude Code and Copilot.
