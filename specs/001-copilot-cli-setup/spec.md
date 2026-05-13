# Feature Specification: Copilot CLI Setup Command

**Feature Branch**: `001-copilot-cli-setup`
**Created**: 2025-07-24
**Status**: Draft
**Input**: Add a `npx mcp-automem copilot` CLI command that installs AutoMem hooks for GitHub Copilot (both CLI and VS Code).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Install AutoMem hooks for Copilot CLI (Priority: P1)

A developer who uses GitHub Copilot CLI wants to add AutoMem memory persistence to their Copilot sessions. They run `npx mcp-automem copilot` and the command installs hook JSON files, support scripts, and a memory rules template into `~/.copilot/`. After installation, Copilot sessions automatically recall relevant memories at start, capture significant events (builds, tests, deployments) during the session, and drain the memory queue at session end.

**Why this priority**: This is the core value proposition - without hook installation, the feature delivers nothing. The default `--format cli` covers the primary Copilot CLI audience.

**Independent Test**: Can be fully tested by running `npx mcp-automem copilot --dry-run` and verifying the list of files that would be created, then running without `--dry-run` and confirming all files exist with correct content at `~/.copilot/hooks/` and `~/.copilot/scripts/`.

**Acceptance Scenarios**:

1. **Given** a developer has mcp-automem installed and `~/.copilot/` does not exist, **When** they run `npx mcp-automem copilot --yes`, **Then** the command creates `~/.copilot/hooks/`, `~/.copilot/scripts/`, installs all hook JSON files and support scripts, and prints a success summary listing all created files.
2. **Given** `~/.copilot/hooks/` already contains hook JSON files from a previous installation, **When** the developer runs `npx mcp-automem copilot --yes`, **Then** existing hook files are backed up (`.bak` suffix) before being overwritten with updated versions.
3. **Given** the developer runs `npx mcp-automem copilot --dry-run`, **When** the command completes, **Then** no files are created or modified on disk, and the output lists every file that would have been written along with its target path.

---

### User Story 2 - Install with VS Code event name format (Priority: P2)

A developer who primarily uses VS Code Copilot (rather than Copilot CLI) wants hook files with PascalCase event names to match VS Code conventions. They run `npx mcp-automem copilot --format vscode` and the installer generates hook JSON files with PascalCase event names (`PostToolUse`, `SessionStart`, `SessionEnd`) instead of the default camelCase.

**Why this priority**: The `--format` flag is a configuration variant of the core installation. It broadens compatibility but the default format already works for both surfaces, making this a convenience feature.

**Independent Test**: Can be tested by running `npx mcp-automem copilot --format vscode --dry-run` and verifying the generated hook JSON files use PascalCase event names.

**Acceptance Scenarios**:

1. **Given** a developer runs `npx mcp-automem copilot --format vscode --yes`, **When** the command completes, **Then** the hook JSON files in `~/.copilot/hooks/` use PascalCase event names (`SessionStart`, `PostToolUse`, `SessionEnd`).
2. **Given** a developer runs `npx mcp-automem copilot --format cli --yes`, **When** the command completes, **Then** the hook JSON files use camelCase event names (`sessionStart`, `postToolUse`, `sessionEnd`).
3. **Given** a developer runs `npx mcp-automem copilot --yes` (no `--format` flag), **When** the command completes, **Then** the hook JSON files default to camelCase event names (CLI format).

---

### User Story 3 - Install to a custom directory (Priority: P3)

A developer uses a non-standard Copilot config location (e.g., for testing or multi-profile setups). They use `--dir /path/to/custom` to redirect all file installations to a custom base directory instead of `~/.copilot/`.

**Why this priority**: Power-user and testing convenience. Not needed for the default workflow but critical for `--dry-run` testing and CI validation.

**Independent Test**: Can be tested by running `npx mcp-automem copilot --dir /tmp/test-copilot --yes` and verifying files are created under `/tmp/test-copilot/hooks/` and `/tmp/test-copilot/scripts/`.

**Acceptance Scenarios**:

1. **Given** a developer specifies `--dir /tmp/test-copilot`, **When** the command completes, **Then** all hook JSON files, support scripts, and the memory rules template are installed under `/tmp/test-copilot/` instead of `~/.copilot/`.
2. **Given** a developer specifies `--dir` pointing to a non-existent directory, **When** the command runs, **Then** the command creates the directory tree (including `hooks/` and `scripts/` subdirectories) before installing files.

---

### User Story 4 - Memory rules template for copilot-instructions.md (Priority: P2)

A developer wants AutoMem memory rules integrated into their Copilot instructions file. The installer creates a `COPILOT_INSTRUCTIONS_MEMORY_RULES.md` template that the developer can append to `~/.copilot/copilot-instructions.md`.

**Why this priority**: Memory rules tell Copilot how to use AutoMem tools effectively. Without them, hooks capture data but Copilot may not proactively recall or store memories during sessions.

**Independent Test**: Can be tested by verifying the template file is created at `templates/COPILOT_INSTRUCTIONS_MEMORY_RULES.md` in the package and that `npx mcp-automem copilot --yes` outputs instructions for appending it to `copilot-instructions.md`.

**Acceptance Scenarios**:

1. **Given** a developer runs `npx mcp-automem copilot --yes`, **When** the command completes, **Then** the output includes instructions explaining how to append the memory rules template to `~/.copilot/copilot-instructions.md`.
2. **Given** `~/.copilot/copilot-instructions.md` already exists, **When** the installer runs, **Then** it does NOT automatically modify `copilot-instructions.md` (the developer appends manually to avoid overwriting custom instructions).

---

### Edge Cases

- What happens when `~/.copilot/hooks/` contains hook files from a different tool (not AutoMem)?
  - The installer only writes AutoMem-specific hook files (by filename). It does not modify or remove other hook files.
- What happens when the developer lacks write permissions to `~/.copilot/`?
  - The command reports a clear error message identifying the permission issue and exits with a non-zero status code.
- What happens when `--format` is given an invalid value (not `cli` or `vscode`)?
  - The command prints an error listing the valid options and exits with a non-zero status code.
- What happens on Windows where `~` resolves differently?
  - The command uses the platform's home directory (`os.homedir()`) to resolve `~/.copilot/`, consistent with how the existing `claude-code` command resolves `~/.claude/`.
- What happens when the user runs `copilot` without `--yes` and there's no interactive terminal?
  - The command detects non-interactive mode and proceeds as if `--yes` were specified, consistent with existing CLI commands.
- What happens if the installer is interrupted mid-write (e.g., Ctrl+C during installation)?
  - No file-locking or atomic-write protection is implemented. The installer writes small files sequentially and completes in under a second. If interrupted, previously written files remain intact and any partially written file can be recovered by re-running the installer (which creates `.bak` backups before overwriting). This matches the existing `claude-code` installer behavior.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST provide a `copilot` CLI subcommand accessible via `npx mcp-automem copilot`.
- **FR-002**: System MUST install standalone hook JSON files into `<target-dir>/hooks/` using Copilot's native hook format (`version: 1`, `hooks` block with `bash` and `powershell` command entries). Files MUST use automem-prefixed names: `automem-session-start.json`, `automem-post-tool-use.json`, `automem-session-end.json`.
- **FR-003**: System MUST install hook files for three event groups: session start (memory recall), post-tool-use (event capture for bash/powershell tool matchers), and session end (memory capture + queue drain).
- **FR-004**: System MUST install support scripts into `<target-dir>/scripts/` adapted from the existing claude-code scripts, with path references remapped from `~/.claude/` to `~/.copilot/`.
- **FR-005**: System MUST provide a `--format cli|vscode` flag (default: `cli`) that controls event name casing in generated hook JSON files - camelCase for `cli`, PascalCase for `vscode`.
- **FR-006**: System MUST include help text for the `--format` flag explaining that either format works for both Copilot CLI and VS Code, with a link to the hooks reference documentation.
- **FR-007**: System MUST support `--dir <path>` (default: `~/.copilot`) to override the target installation directory.
- **FR-008**: System MUST support `--dry-run` to preview all file operations without writing to disk.
- **FR-009**: System MUST support `--yes` (and `-y`) to skip interactive confirmation prompts.
- **FR-010**: System MUST support `--quiet` to suppress non-error output.
- **FR-011**: System MUST create backup copies of existing files (`.bak` suffix) before overwriting, consistent with the existing `claude-code` installer behavior.
- **FR-012**: System MUST create a `COPILOT_INSTRUCTIONS_MEMORY_RULES.md` template in the package's `templates/` directory, equivalent to the existing `CLAUDE_MD_MEMORY_RULES.md` but adapted for Copilot tool naming conventions.
- **FR-013**: System MUST register the `copilot` command in `src/index.ts` command routing alongside existing `claude-code`, `cursor`, `codex`, and `openclaw` commands.
- **FR-014**: Support scripts MUST handle the difference that Copilot hooks deliver JSON payload on stdin (not via environment variables as in Claude Code).
- **FR-015**: System MUST create target directories (`hooks/`, `scripts/`) if they do not exist.
- **FR-016**: System MUST print a post-installation summary listing all files created or modified and next steps (including how to append memory rules to `copilot-instructions.md`).
- **FR-017**: System MUST set file permissions consistent with the existing claude-code installer: `0755` (owner rwx, group/other rx) for executable scripts, standard/default permissions for JSON and markdown files.

### Key Entities

- **Hook JSON File**: A standalone JSON file following Copilot's hook format with `version`, `hooks` array containing entries with event type, optional matchers, and `command` object with `bash` and `powershell` keys. One file per event group installed into `<target-dir>/hooks/` using automem-prefixed names: `automem-session-start.json`, `automem-post-tool-use.json`, `automem-session-end.json`.
- **Support Script**: A bash/shell script that processes hook events - reads JSON payload from stdin, extracts relevant data, and queues memory entries to a JSONL file. Installed into `<target-dir>/scripts/`.
- **Memory Rules Template**: A markdown file containing instructions for Copilot on how to use AutoMem tools, adapted from the existing Claude Code memory rules. Packaged in `templates/` and referenced in post-install output.
- **Memory Queue**: A JSONL file (`<target-dir>/scripts/memory-queue.jsonl`) where hook scripts append captured events for later processing by `npx mcp-automem queue`.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A developer can install AutoMem hooks for Copilot in under 30 seconds by running a single command (`npx mcp-automem copilot --yes`).
- **SC-002**: After installation, the `~/.copilot/hooks/` directory contains valid hook JSON files for all three event groups (session start, post-tool-use, session end).
- **SC-003**: After installation, the `~/.copilot/scripts/` directory contains all required support scripts with correct path references to `~/.copilot/`.
- **SC-004**: The `--dry-run` flag produces accurate output matching 100% of the files that would be created by a real run.
- **SC-005**: Both `--format cli` and `--format vscode` produce valid hook JSON that Copilot accepts without errors.
- **SC-006**: The `--dir` flag correctly redirects all file installations to the specified directory with no hardcoded `~/.copilot/` references leaking through.
- **SC-007**: Existing files are preserved via `.bak` backups with zero data loss during re-installation.
- **SC-008**: The command is discoverable via `npx mcp-automem help` and its help text includes usage examples and flag descriptions.

## Assumptions

- Copilot's hook system uses standalone JSON files in `~/.copilot/hooks/` (not a merged settings.json approach). This is based on the user's description and the referenced hooks documentation.
- The `~/.copilot/` directory may not exist before the installer runs; the installer will create it.
- Both Copilot CLI and VS Code Copilot share the same `~/.copilot/` config directory and hooks system, differing only in event name casing conventions.
- Hook scripts need cross-platform support (bash for macOS/Linux, PowerShell for Windows), matching the `bash` + `powershell` keys in Copilot's hook JSON format.
- The existing `memory-queue.jsonl` queue format and `npx mcp-automem queue` processor are reusable as-is; no changes needed to the queue subsystem.
- The existing `src/cli/queue.ts` queue processor will work with the Copilot queue file location (`~/.copilot/scripts/memory-queue.jsonl`) when the `--file` flag is used, or by default if the session end hook invokes it with the correct path.
- The AutoMem API client (`automem-client.ts`) does not need modifications - the Copilot integration uses the same API endpoints as all other integrations.
- The installer does not require file-locking or atomic-write mechanisms. Files are small, written sequentially, and the operation completes in under a second. Recovery from interrupted writes is handled by re-running the installer, which creates `.bak` backups before overwriting.

## Dependencies

- GitHub Copilot hooks system (https://docs.github.com/en/copilot/reference/hooks-reference) - external dependency on Copilot's hook file format remaining stable.
- Existing AutoMem CLI infrastructure (`src/index.ts` command routing, `src/cli/` patterns).
- Existing support scripts in `templates/claude-code/scripts/` as the basis for adapted Copilot scripts.
- Existing `templates/CLAUDE_MD_MEMORY_RULES.md` as the basis for the Copilot memory rules template.

## Clarifications

### Session 2026-05-12

- Q: What file permissions should the installer set for generated scripts and JSON files? -> A: Match the existing claude-code installer (0755 for scripts, standard/default for JSON files).
- Q: What naming convention for the hook JSON filenames installed into hooks/? -> A: AutoMem-prefixed: automem-session-start.json, automem-post-tool-use.json, automem-session-end.json.
- Q: What concurrency protection or partial-write recovery strategy should the installer use? -> A: No protection needed. Sequential writes with .bak backups for recovery, matching existing claude-code installer behavior.

## Out of Scope

- Automatic modification of `~/.copilot/copilot-instructions.md` - the installer only provides a template and instructions.
- MCP server configuration for Copilot - this command only installs hooks and scripts, not MCP server registration (that remains a separate `setup` or `config` step).
- Hook profiles (lean/extras) - unlike the `claude-code` command which has `--profile` support, the initial Copilot command installs a single default set of hooks. Profiles can be added in a future iteration.
- Uninstall support for the `copilot` target - the existing `uninstall` command would need a separate update to support `copilot` as a target.
- Migrate support for Copilot - migration from/to Copilot is out of scope for this feature.
- PowerShell support scripts - the initial release provides bash scripts with PowerShell stubs in hook JSON. Full PowerShell script equivalents can be added in a future iteration.
