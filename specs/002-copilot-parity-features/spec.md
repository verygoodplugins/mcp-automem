# Feature Specification: Copilot CLI Parity Features

**Feature Branch**: `002-copilot-parity-features`  
**Created**: 2025-07-25  
**Status**: Draft  
**Input**: User description: "Add parity features to the `npx mcp-automem copilot` command bringing it to feature-complete parity with the existing `claude-code` command - hook profiles, uninstall, migrate, and full PowerShell scripts."
**Depends On**: Spec 001 (core Copilot hook installer on branch `001-copilot-cli-setup`)

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Install Copilot Hooks with Profile Selection (Priority: P1)

A user wants to install AutoMem hooks for GitHub Copilot CLI but wants control over which hooks are installed. They run `npx mcp-automem copilot --profile lean` to get a minimal, quiet setup (session-start and session-end hooks only), or `--profile extras` to get the full set of hooks including post-tool-use hooks for build, test, and deploy events.

**Why this priority**: Profiles directly control the user experience of the core installer. Without profiles, users get an all-or-nothing installation with no way to customize signal-to-noise ratio. This is the most impactful parity gap because the claude-code command already supports `--profile lean` and `--profile extras`.

**Independent Test**: Can be fully tested by running `npx mcp-automem copilot --profile lean --dry-run` and verifying that only session-start and session-end hook JSON files appear in the output. Delivers value by letting users choose their preferred hook density.

**Acceptance Scenarios**:

1. **Given** the copilot command is available and no hooks are installed, **When** the user runs `npx mcp-automem copilot --profile lean`, **Then** only session-start and session-end hook JSON files are installed to the hooks directory.
2. **Given** the copilot command is available and no hooks are installed, **When** the user runs `npx mcp-automem copilot --profile extras`, **Then** all hook JSON files are installed (session-start, post-tool-use for build/test/deploy, session-end).
3. **Given** no profile flag is provided, **When** the user runs `npx mcp-automem copilot`, **Then** the default profile is used (lean - matching claude-code's default behavior).
4. **Given** hooks are already installed with the extras profile, **When** the user re-runs with `--profile lean`, **Then** the extra hooks are removed and only lean hooks remain.
5. **Given** the user passes an invalid profile name, **When** they run `npx mcp-automem copilot --profile invalid`, **Then** the command exits with a clear error message listing valid profiles.

---

### User Story 2 - Full PowerShell Support for Windows Users (Priority: P1)

A Windows user installs Copilot hooks and expects the hooks to actually capture memory events. Currently (per spec 001), the PowerShell keys in hook JSON point to warning stubs that exit without capturing anything. This story delivers real `.ps1` scripts that mirror the bash scripts' functionality.

**Why this priority**: Equal priority with profiles because without functional PowerShell scripts, Windows users - a significant portion of the Copilot CLI user base - get zero value from the hook system. The hooks are installed but do nothing.

**Independent Test**: Can be fully tested on a Windows machine by triggering a build event and verifying that a memory entry is queued to the JSONL file. Delivers value by making the entire hook system functional on Windows.

**Acceptance Scenarios**:

1. **Given** a Windows user has installed Copilot hooks, **When** a build event occurs and the hook fires, **Then** the `capture-build-result.ps1` script captures the build outcome and queues a memory entry to the JSONL queue file.
2. **Given** a Windows user has installed Copilot hooks, **When** a test run completes, **Then** the `capture-test-pattern.ps1` script captures the test results (pass/fail count, patterns) and queues a memory entry.
3. **Given** a Windows user has installed Copilot hooks, **When** a deployment event occurs, **Then** the `capture-deployment.ps1` script captures deployment details and queues a memory entry.
4. **Given** a Windows user has installed Copilot hooks, **When** a session ends, **Then** the `session-memory.ps1` script processes the session context and queues a summary memory entry.
5. **Given** a Windows user has installed Copilot hooks, **When** the queue cleanup runs, **Then** the `queue-cleanup.ps1` script drains the JSONL queue to AutoMem via `npx mcp-automem queue`.
6. **Given** a Windows user has installed Copilot hooks, **When** a hook needs to locate Python, **Then** the `python-command.ps1` script correctly finds the Python executable (python3 or python) on the system PATH.
7. **Given** the PowerShell scripts are installed, **When** the hook JSON files reference them, **Then** the `powershell` key in each hook JSON points to the real `.ps1` script (not the warning stub from spec 001).

---

### User Story 3 - Uninstall Copilot Hooks (Priority: P2)

A user who previously installed Copilot hooks wants to cleanly remove them. They run `npx mcp-automem uninstall copilot` and all AutoMem-related hook files and support scripts are removed. Optionally, they can use `--clean-all` to also remove the MCP server configuration.

**Why this priority**: Uninstall is essential for user trust and clean removal, but it's a less frequent operation than installation. Users need confidence that they can reverse the installation.

**Independent Test**: Can be fully tested by installing hooks, then running `npx mcp-automem uninstall copilot --dry-run` and verifying the listed files match what was installed. Delivers value by providing a clean removal path.

**Acceptance Scenarios**:

1. **Given** Copilot hooks are installed in the default hooks directory, **When** the user runs `npx mcp-automem uninstall copilot`, **Then** all AutoMem-prefixed hook JSON files are removed from the hooks directory.
2. **Given** Copilot support scripts are installed, **When** the user runs `npx mcp-automem uninstall copilot`, **Then** all AutoMem support scripts (bash and PowerShell) are removed from the scripts directory.
3. **Given** the user wants to also remove MCP server config, **When** they run `npx mcp-automem uninstall copilot --clean-all`, **Then** the AutoMem server entry is removed from `~/.copilot/mcp-config.json` (or equivalent).
4. **Given** the user has not confirmed, **When** they run `npx mcp-automem uninstall copilot` without `--yes`, **Then** the command prompts for confirmation before removing anything.
5. **Given** the user wants to preview changes, **When** they run `npx mcp-automem uninstall copilot --dry-run`, **Then** the command lists all files that would be removed without actually removing them.
6. **Given** the user provides a custom directory, **When** they run `npx mcp-automem uninstall copilot --dir <path>`, **Then** the uninstall targets the specified directory instead of the default.
7. **Given** no AutoMem hooks are installed, **When** the user runs `npx mcp-automem uninstall copilot`, **Then** the command reports that no AutoMem files were found and exits cleanly.

---

### User Story 4 - Migrate to Copilot from Other Setups (Priority: P3)

A user currently using manual memory management or another integration wants to migrate to the Copilot hook-based setup. They run `npx mcp-automem migrate --from manual --to copilot` and the system analyzes their current usage and installs the Copilot hooks.

**Why this priority**: Migration is a convenience feature for users transitioning between setups. It builds on the core installer (story 1) and is less critical than the primary install/uninstall path.

**Independent Test**: Can be fully tested by running `npx mcp-automem migrate --from manual --to copilot --dry-run` in a project with manual memory usage and verifying the analysis output and planned installation. Delivers value by providing a guided transition path.

**Acceptance Scenarios**:

1. **Given** the user has manual memory usage in their project, **When** they run `npx mcp-automem migrate --from manual --to copilot`, **Then** the command analyzes existing memory usage, reports findings, and installs Copilot hooks.
2. **Given** the user has no prior memory setup, **When** they run `npx mcp-automem migrate --from none --to copilot`, **Then** the command installs Copilot hooks as a fresh setup.
3. **Given** the user specifies `--to copilot`, **When** the migrate command runs, **Then** it calls the Copilot installer (equivalent to `npx mcp-automem copilot`) with forwarded flags (--dry-run, --yes, --quiet).
4. **Given** the user wants to preview the migration, **When** they run with `--dry-run`, **Then** the command shows the analysis and planned changes without modifying anything.
5. **Given** `copilot` is passed as a `--from` source, **When** the user runs `npx mcp-automem migrate --from copilot --to claude-code`, **Then** the command analyzes existing Copilot hooks and migrates to claude-code format.

---

### Edge Cases

- What happens when the user runs `copilot --profile lean` on top of an existing `extras` installation? Remove-first strategy: extra hooks are deleted before lean hooks are written. If deletion succeeds but installation fails partway, the user has fewer hooks (safe degradation) and can re-run to recover.
- What happens when uninstall is run but some hook files have been manually modified? The command should still remove AutoMem-prefixed files and warn about any non-standard files found.
- What happens when PowerShell scripts fail to find Python or encounter any error? All PS hook scripts fail silently (exit 0) and log the error to stderr for debugging. This ensures hook failures never block the user's coding workflow, matching the bash scripts' existing behavior. The `python-command.ps1` script logs a warning to stderr if Python is not found but still exits 0.
- What happens on a system where both bash and PowerShell are available? Hook JSON should reference both the `.sh` and `.ps1` scripts via their respective keys - the Copilot CLI runtime selects the appropriate one based on the shell.
- What happens when the queue JSONL file does not exist during cleanup? The cleanup script should exit cleanly without error.
- What happens when uninstall `--clean-all` is run but no MCP config file exists? The command should report that no config was found and continue without error.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The `copilot` command MUST accept a `--profile` flag with values `lean` and `extras`.
- **FR-002**: The `lean` profile MUST install only session-start and session-end hook JSON files.
- **FR-003**: The `extras` profile MUST install all hook JSON files (session-start, post-tool-use for build/test/deploy, session-end).
- **FR-004**: When no `--profile` flag is provided, the command MUST default to the `lean` profile.
- **FR-005**: Re-running with a different profile MUST use a remove-first strategy: delete hooks not in the target profile, then install the target set. Partial failure during this transition MUST leave fewer hooks (safe degradation), never stale hooks. Users can re-run to recover.
- **FR-006**: The `uninstall` command MUST accept `copilot` as a valid platform target alongside existing `cursor` and `claude-code` targets.
- **FR-007**: Uninstalling copilot MUST remove all AutoMem-prefixed hook JSON files from the hooks directory.
- **FR-008**: Uninstalling copilot MUST remove all AutoMem support scripts (both `.sh` and `.ps1`) from the scripts directory.
- **FR-009**: Uninstalling copilot with `--clean-all` MUST also remove the AutoMem server entry from the Copilot MCP configuration file.
- **FR-010**: The `migrate` command MUST accept `copilot` as a valid `--to` target.
- **FR-011**: The `migrate` command MUST accept `copilot` as a valid `--from` source.
- **FR-012**: Migration to copilot MUST install hooks via the same code path as the `copilot` command (reuse, not duplicate).
- **FR-013**: Full PowerShell `.ps1` scripts MUST be provided for: `capture-build-result`, `capture-test-pattern`, `capture-deployment`, `session-memory`, `queue-cleanup`, and `python-command`.
- **FR-013a**: All PowerShell hook scripts MUST fail silently (exit 0) on any error and log the error to stderr for debugging. Hook scripts are background plumbing and MUST NOT block the user's coding workflow. This matches the bash scripts' existing error-handling behavior.
- **FR-014**: Each PowerShell script MUST produce equivalent output to its bash counterpart (same JSONL queue format, same environment variable inputs). PowerShell scripts MUST be queue-only - they append entries to the JSONL queue file and MUST NOT call the AutoMem API directly. The queue is drained via `npx mcp-automem queue` at session end.
- **FR-015**: Hook JSON files MUST reference the real `.ps1` scripts in their `powershell` key instead of the warning stubs delivered by spec 001. The `powershell` value MUST use `powershell -ExecutionPolicy Bypass -File <script>` to avoid system-level execution policy blocks.
- **FR-016**: The uninstall command MUST support `--dir`, `--dry-run`, `--yes`, and `--quiet` flags for the copilot target (matching existing flag behavior for cursor and claude-code).
- **FR-017**: The uninstall command MUST create backups of removed files before deletion (matching existing backup behavior).
- **FR-018**: Profile template files MUST be stored under `templates/copilot/profiles/` to parallel the claude-code profile structure.

### Key Entities

- **Hook Profile**: A named set of hook JSON files (`lean` or `extras`) that determines which events trigger memory capture. Each profile maps to a directory of hook JSON templates.
- **Hook JSON File**: A standalone JSON file in the Copilot hooks directory that defines a single hook trigger (event type, shell command, PowerShell command). The `powershell` key uses `powershell -ExecutionPolicy Bypass -File <script>` to invoke `.ps1` scripts without relying on the system execution policy.
- **Support Script**: A shell script (`.sh` or `.ps1`) that performs memory capture logic - invoked by hook JSON files.
- **JSONL Queue**: A newline-delimited JSON file at `~/.copilot/scripts/memory-queue.jsonl` where hook scripts append memory entries for later batch processing by `npx mcp-automem queue`. PowerShell scripts are queue-only - they never call the AutoMem API directly; the queue drain at session end is the sole integration point.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Users can install hooks with `--profile lean` and only 2 hook files (session-start, session-end) appear in the hooks directory.
- **SC-002**: Users can install hooks with `--profile extras` and all hook files (session-start, build, test, deploy, session-end) appear in the hooks directory.
- **SC-003**: Users can cleanly uninstall all AutoMem Copilot files with a single command and no residual files remain.
- **SC-004**: Windows users with PowerShell scripts installed can trigger a build hook and see a valid memory entry queued in the JSONL file.
- **SC-005**: Migration from `manual` or `none` to `copilot` produces the same hook installation as running the `copilot` command directly.
- **SC-006**: All PowerShell scripts produce JSONL output with the same schema as their bash counterparts (content, tags, importance, metadata fields).
- **SC-007**: The `--dry-run` flag for all commands (copilot, uninstall, migrate) shows planned changes without modifying any files.
- **SC-008**: Re-running `copilot --profile lean` after a prior `--profile extras` installation results in exactly the lean set of hooks with no extras remaining.

## Clarifications

### Session 2025-07-25

- Q: How should hook JSON invoke PowerShell scripts given execution policy restrictions on Windows? → A: Hook JSON uses `powershell -ExecutionPolicy Bypass -File <script>` per invocation.
- Q: Where should PowerShell scripts write the JSONL memory queue file? → A: `~/.copilot/scripts/memory-queue.jsonl` (parallel to claude-code layout under `~/.claude/scripts/`).
- Q: How should profile switching handle the transition when re-running with a different profile? → A: Remove-first strategy. Remove extra hooks before installing new set. Partial failure results in fewer hooks (safe degradation). Re-run to recover.
- Q: Should PowerShell scripts call the AutoMem API directly or use the JSONL queue pattern? → A: Queue-only. PS scripts append JSONL entries to the queue file. The queue is drained via `npx mcp-automem queue` at session end (mirroring bash architecture).
- Q: How should PowerShell scripts handle errors (e.g., Python not found, file write failure)? → A: Fail silently (exit 0), log error to stderr for debugging. Hook scripts are background plumbing and must never block the user's coding workflow. This matches the bash scripts' existing behavior.

## Assumptions

- Spec 001 (core Copilot hook installer) has been implemented and merged, providing the base `copilot` command, hook JSON file structure, and bash support scripts.
- The Copilot CLI hooks directory path (`~/.copilot/hooks/` or equivalent) and MCP config path (`~/.copilot/mcp-config.json` or equivalent) are as established by spec 001. The exact paths will be confirmed during planning.
- Hook JSON files installed by AutoMem use an `automem-` prefix in their filenames, allowing safe identification during uninstall without affecting non-AutoMem hooks.
- PowerShell scripts can rely on `npx` being available on the system PATH (Node.js is a prerequisite for mcp-automem).
- The JSONL queue file format and memory entry schema are the same as used by the claude-code hooks (content, tags, importance, metadata).
- The `process-session-memory.py` script is already cross-platform (Python) and does not need a PowerShell equivalent.
- The default profile (`lean`) matches the claude-code command's default behavior where the lean profile is the recommended starting point.
- Migration from copilot to other targets (e.g., `--from copilot --to claude-code`) is a low-frequency operation and can perform a fresh installation of the target rather than translating hook-by-hook.
