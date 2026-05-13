# Research: Copilot Parity Features

**Date**: 2025-07-25 | **Plan**: [plan.md](plan.md)

## R1: Profile System Design

**Decision**: Mirror the claude-code profile approach but adapted for Copilot's hook JSON structure. Each profile is a JSON file under `templates/copilot/profiles/` that lists which hook JSON filenames belong to that profile.

**Rationale**: The claude-code command uses `settings.lean.json` and `settings.extras.json` that are full settings overlays. For Copilot, hook JSON files are standalone files (one per hook), so profiles are simpler - just a list of which hook files to install.

**Alternatives considered**:
- Full settings overlay files (like claude-code) - rejected because Copilot hooks are individual JSON files, not a single settings.json. A filename list is more natural.
- Embedding profile metadata in each hook JSON - rejected because it couples hook definitions to the profile system.

**Profile definitions**:
- `lean.json`: `["automem-session-start.json", "automem-session-end.json"]`
- `extras.json`: `["automem-session-start.json", "automem-build.json", "automem-test.json", "automem-deploy.json", "automem-session-end.json"]`

**Profile switching**: Remove-first strategy per spec. Read target profile's file list, delete any hook files with `automem-` prefix not in the list, then install the target set.

## R2: PowerShell Script Architecture

**Decision**: Each `.ps1` script mirrors its `.sh` counterpart's logic but uses native PowerShell constructs. All PS scripts are queue-only - they append JSONL to `~/.copilot/scripts/memory-queue.jsonl` and never call the AutoMem API directly.

**Rationale**: The bash scripts use a pattern of: (1) resolve Python via helper, (2) parse stdin JSON, (3) detect relevant commands, (4) build a memory record, (5) append to JSONL queue via Python (for cross-platform file locking). The PS scripts can simplify this because PowerShell has native JSON parsing (`ConvertFrom-Json`, `ConvertTo-Json`) and file operations without needing Python as an intermediary.

**Alternatives considered**:
- Transliterate bash scripts 1:1 including Python blocks - rejected because PowerShell has native JSON handling, making Python unnecessary for the PS versions.
- Use Python for all PS scripts too - rejected because it adds an unnecessary dependency for Windows users when PowerShell can handle JSON natively.
- Call AutoMem API directly from PS scripts - rejected per spec requirement FR-014 (queue-only).

**Error handling pattern** (per FR-013a):
```powershell
try {
    # Script logic here
} catch {
    Write-Error "AutoMem hook error: $_"
    exit 0  # Never block user workflow
}
```

**File locking**: Use `[System.IO.File]::Open()` with `FileShare.None` for atomic JSONL appends (equivalent to the Python `fcntl`/`msvcrt` locking in bash scripts).

**Hook JSON invocation format** (per FR-015):
```json
{
  "powershell": "powershell -ExecutionPolicy Bypass -File \"$HOME/.copilot/scripts/capture-build-result.ps1\""
}
```

## R3: Uninstall Extension Pattern

**Decision**: Add `'copilot'` to the `UninstallOptions.platform` union type and implement `uninstallCopilot()` following the same structure as `uninstallClaudeCode()` and `uninstallCursor()`.

**Rationale**: The existing `uninstall.ts` has a clean platform-dispatch pattern (`if (options.platform === 'cursor') ... else if (options.platform === 'claude-code') ...`). Adding copilot follows this pattern exactly.

**Copilot-specific uninstall targets**:
1. All `automem-*.json` hook files from `~/.copilot/hooks/`
2. All AutoMem support scripts (`.sh` and `.ps1`) from `~/.copilot/scripts/`
3. With `--clean-all`: AutoMem server entry from `~/.copilot/mcp-config.json`

**Alternatives considered**:
- Separate `uninstall-copilot.ts` file - rejected because the existing uninstall.ts is designed for multi-platform dispatch.
- Generic uninstall that auto-detects platform - rejected because explicit platform argument matches existing UX and is safer.

## R4: Migration Extension Pattern

**Decision**: Add `'copilot'` to both `MigrateOptions.from` and `MigrateOptions.to` union types. Migration to copilot reuses the copilot installer (same code path per FR-012). Migration from copilot performs analysis then installs target platform.

**Rationale**: The existing `migrate.ts` dispatches to platform installers (`applyCursorSetup`, `applyClaudeCodeSetup`). Adding copilot follows the same pattern via `applyCopilotSetup` (or whatever the installer export from spec 001 is named).

**Alternatives considered**:
- Hook-by-hook translation between platforms - rejected per spec assumption (low-frequency operation, fresh install is simpler).
- Separate migration command for copilot - rejected because the existing `migrate` command is designed for multi-platform support.

## R5: Copilot Directory Layout

**Decision**: Follow paths established by spec 001:
- Hooks directory: `~/.copilot/hooks/`
- Scripts directory: `~/.copilot/scripts/`
- MCP config: `~/.copilot/mcp-config.json`
- JSONL queue: `~/.copilot/scripts/memory-queue.jsonl`
- Logs: `~/.copilot/logs/`

**Rationale**: Parallels the claude-code layout (`~/.claude/hooks/`, `~/.claude/scripts/`, etc.) and matches the spec's stated assumption.

## R6: Python Dependency in PowerShell Scripts

**Decision**: PowerShell scripts do NOT require Python. They use native PowerShell for all JSON handling and file operations. The `python-command.ps1` script is still provided as a utility for any future script that might need Python, but the core hook scripts (`capture-build-result.ps1`, `capture-test-pattern.ps1`, `capture-deployment.ps1`, `session-memory.ps1`) handle everything natively.

**Rationale**: The bash scripts need Python because bash has no built-in JSON handling. PowerShell has `ConvertFrom-Json`/`ConvertTo-Json` natively, eliminating that dependency. The `queue-cleanup.ps1` can also use native PS JSON handling instead of `jq` + Python.

**Exception**: `process-session-memory.py` is already cross-platform Python and does not need a PS equivalent (per spec assumption).
