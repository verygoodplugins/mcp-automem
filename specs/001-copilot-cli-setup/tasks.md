# Tasks: Copilot CLI Setup Command

**Input**: Design documents from `/specs/001-copilot-cli-setup/`
**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/

**Tests**: No test tasks are included by default. The spec does not explicitly request TDD. Tests can be added via a separate pass if needed.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Path Conventions

- **Single project**: `src/`, `tests/`, `templates/` at repository root
- Paths use the project structure from plan.md

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Create the template directory structure and shared type definitions needed by all user stories

- [X] T001 Create the Copilot template directory tree: `templates/copilot/hooks/` and `templates/copilot/scripts/`
- [X] T002 Add `CopilotSetupOptions` interface and `EVENT_NAMES` constant map to `src/cli/copilot.ts` (matching existing pattern where `ClaudeCodeSetupOptions` lives in `src/cli/claude-code.ts`) per data-model.md entities (CopilotSetupOptions, EventNameMap)
- [X] T003 [P] Add `CopilotHookFile` and `CopilotHookEntry` TypeScript interfaces to `src/cli/copilot.ts` per data-model.md Hook JSON File entity

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Create the hook JSON templates and support scripts that ALL user stories depend on. These are the files the installer copies - without them, no story can function.

**Warning**: No user story work can begin until this phase is complete

- [X] T004 Create session-start hook JSON template at `templates/copilot/hooks/automem-session-start.json` using Copilot v1 format with `prompt` type hook and camelCase event name (`sessionStart`) per research.md R1/R6
- [X] T005 [P] Create post-tool-use hook JSON template at `templates/copilot/hooks/automem-post-tool-use.json` using Copilot v1 format with `command` type hooks for bash/powershell tool matchers per research.md R1/R4
- [X] T006 [P] Create session-end hook JSON template at `templates/copilot/hooks/automem-session-end.json` using Copilot v1 format with `command` type hooks for queue drain and session memory capture per research.md R1/R4
- [X] T007 Create `templates/copilot/scripts/automem-session-start.sh` - memory recall prompt script adapted from `templates/claude-code/scripts/` with `~/.copilot/` paths per research.md R5
- [X] T008 [P] Create `templates/copilot/scripts/capture-build-result.sh` - adapted from claude-code with stdin JSON parsing (read stdin via `jq`/python, map to AUTOMEM_* env vars) and `~/.copilot/` paths per research.md R3/R5
- [X] T009 [P] Create `templates/copilot/scripts/capture-test-pattern.sh` - adapted from claude-code with stdin JSON parsing and `~/.copilot/` paths per research.md R3/R5
- [X] T010 [P] Create `templates/copilot/scripts/capture-deployment.sh` - adapted from claude-code with stdin JSON parsing and `~/.copilot/` paths per research.md R3/R5
- [X] T011 [P] Create `templates/copilot/scripts/session-memory.sh` - adapted from claude-code with stdin JSON parsing and `~/.copilot/` paths per research.md R3/R5
- [X] T012 [P] Create `templates/copilot/scripts/python-command.sh` - python version resolver utility adapted from claude-code with `~/.copilot/` paths
- [X] T013 [P] Create `templates/copilot/scripts/queue-cleanup.sh` - queue deduplication/archive script adapted from claude-code with `~/.copilot/` paths
- [X] T014 [P] Create `templates/copilot/scripts/process-session-memory.py` - python session memory processor adapted from claude-code with `~/.copilot/` paths
- [X] T015 [P] Create `templates/copilot/scripts/memory-filters.json` - filter configuration for memory significance adapted from claude-code

**Checkpoint**: All template files exist. The installer module can now be built.

---

## Phase 3: User Story 1 - Install AutoMem hooks for Copilot CLI (Priority: P1) - MVP

**Goal**: A developer runs `npx mcp-automem copilot --yes` and gets all hook JSON files, support scripts, and a success summary installed into `~/.copilot/`.

**Independent Test**: Run `npx mcp-automem copilot --dry-run` and verify the list of files that would be created. Then run `npx mcp-automem copilot --dir /tmp/test-copilot --yes` and confirm all files exist at the correct paths with correct content and permissions.

### Implementation for User Story 1

- [X] T016 [US1] Create `src/cli/copilot.ts` with the `CopilotSetupOptions` argument parser (`runCopilotSetup` function) that parses `--dir`, `--format`, `--dry-run`, `--yes`/`-y`, `--quiet` flags with defaults per contracts/cli-interface.md. Auto-set `yes=true` when `!process.stdin.isTTY` (non-interactive terminal detection per spec edge case)
- [X] T017 [US1] Implement `applyCopilotSetup()` in `src/cli/copilot.ts` - core installer logic: create target directories (`hooks/`, `scripts/`), copy hook JSON templates to `<targetDir>/hooks/`, copy support scripts to `<targetDir>/scripts/`, set permissions (0755 for scripts, default for JSON) per FR-002, FR-004, FR-015, FR-017
- [X] T018 [US1] Implement file backup logic in `applyCopilotSetup()` - before overwriting existing files, create `.bak` copies per FR-011 and spec acceptance scenario 1.2
- [X] T019 [US1] Implement `--dry-run` mode in `applyCopilotSetup()` - list all files that would be written without touching disk per FR-008 and contracts/cli-interface.md dry-run output format
- [X] T020 [US1] Implement `--quiet` mode suppression of non-error output in `applyCopilotSetup()` per FR-010
- [X] T021 [US1] Implement post-installation summary output in `applyCopilotSetup()` listing all created/modified files and next steps (including memory rules append instructions) per FR-016 and contracts/cli-interface.md output contract
- [X] T022 [US1] Implement error handling: permission errors (clear message + exit 1), missing template files (package integrity error + exit 1), invalid arguments (error + exit 1) per contracts/cli-interface.md exit codes
- [X] T023 [US1] Register the `copilot` command in `src/index.ts`: add import for `runCopilotSetup` from `./cli/copilot.js`, add help text entry (`copilot            Set up AutoMem for GitHub Copilot`), add command routing (`if (command === 'copilot')`) per FR-013 and contracts/cli-interface.md registration section
- [X] T024 [US1] Add `copilot` help text block to `src/index.ts` showing usage, options (`--format`, `--dir`, `--dry-run`, `--yes`, `--quiet`), and examples per FR-006 and SC-008
- [X] T025 [US1] Verify build passes: run `npm run build` and confirm `dist/cli/copilot.js` is generated without errors

**Checkpoint**: User Story 1 is complete. `npx mcp-automem copilot --yes` installs all hooks and scripts to `~/.copilot/` with default camelCase format. Dry-run, backup, and quiet modes all work.

---

## Phase 4: User Story 2 - Install with VS Code event name format (Priority: P2)

**Goal**: A developer runs `npx mcp-automem copilot --format vscode --yes` and the hook JSON files use PascalCase event names (`SessionStart`, `PostToolUse`, `SessionEnd`).

**Independent Test**: Run `npx mcp-automem copilot --format vscode --dir /tmp/test-vscode --yes` and verify the hook JSON files contain PascalCase event keys. Compare against `--format cli` output to confirm the difference.

### Implementation for User Story 2

- [X] T026 [US2] Implement format-aware hook JSON generation in `applyCopilotSetup()` in `src/cli/copilot.ts` - use the `EVENT_NAMES` map from `src/cli/copilot.ts` to dynamically set event name keys in generated hook JSON based on `options.format` (`cli` = camelCase, `vscode` = PascalCase) per FR-005 and research.md R2
- [X] T027 [US2] Add `--format` validation in `runCopilotSetup()` in `src/cli/copilot.ts` - reject values other than `cli` or `vscode` with error message `Error: Invalid format '<value>'. Valid options: cli, vscode` and exit code 1 per spec edge case and contracts/cli-interface.md error output
- [X] T028 [US2] Add `--format` help text in the `copilot` help block in `src/index.ts` explaining that either format works for both Copilot CLI and VS Code, with a link to https://docs.github.com/en/copilot/reference/hooks-reference per FR-006

**Checkpoint**: Both `--format cli` and `--format vscode` produce valid hook JSON with correct event name casing. Default (no flag) uses camelCase.

---

## Phase 5: User Story 4 - Memory rules template for copilot-instructions.md (Priority: P2)

**Goal**: The installer creates a `COPILOT_INSTRUCTIONS_MEMORY_RULES.md` template with Copilot-specific tool naming that the developer can append to `copilot-instructions.md`.

**Independent Test**: Verify `templates/COPILOT_INSTRUCTIONS_MEMORY_RULES.md` exists in the package with Copilot tool naming (`mcp_<server>_<tool>` for VS Code, `<server>-<tool>` for CLI). Verify the post-install summary references this file.

### Implementation for User Story 4

- [X] T029 [P] [US4] Create `templates/COPILOT_INSTRUCTIONS_MEMORY_RULES.md` adapted from `templates/CLAUDE_MD_MEMORY_RULES.md` with: tool naming changed to `mcp_<server>_<tool>` (VS Code) and `<server>-<tool>` (CLI), references to `~/.copilot/copilot-instructions.md` instead of `~/.claude/CLAUDE.md`, Copilot-specific recall and store examples per FR-012 and research.md R7
- [X] T030 [US4] Ensure the post-installation summary in `applyCopilotSetup()` includes the instruction `cat templates/COPILOT_INSTRUCTIONS_MEMORY_RULES.md >> ~/.copilot/copilot-instructions.md` per spec US4 acceptance scenario 4.1 and contracts/cli-interface.md next steps output

**Checkpoint**: Memory rules template exists and post-install output guides the developer to append it. The installer does NOT auto-modify `copilot-instructions.md`.

---

## Phase 6: User Story 3 - Install to a custom directory (Priority: P3)

**Goal**: A developer uses `--dir /path/to/custom` and all files are installed to that custom base directory instead of `~/.copilot/`.

**Independent Test**: Run `npx mcp-automem copilot --dir /tmp/test-custom --yes` and verify all files exist under `/tmp/test-custom/hooks/` and `/tmp/test-custom/scripts/` with no hardcoded `~/.copilot/` references leaking through.

### Implementation for User Story 3

- [X] T031 [US3] Verify `--dir` flag is fully threaded through `applyCopilotSetup()` in `src/cli/copilot.ts` - ensure ALL file paths, output messages, and directory creation use `options.targetDir` with no hardcoded `~/.copilot/` references per FR-007 and SC-006
- [X] T032 [US3] Implement automatic directory creation when `--dir` points to a non-existent path - create the full directory tree including `hooks/` and `scripts/` subdirectories per FR-015 and spec US3 acceptance scenario 3.2
- [X] T033 [US3] Verify the `--dir` flag works correctly with `--dry-run` - dry-run output should show the custom directory paths per SC-004

**Checkpoint**: All stories complete. The `--dir` flag correctly redirects all installations with zero leaking hardcoded paths.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Final validation, package metadata, and cross-cutting quality

- [X] T034 [P] Add `templates/copilot/` and `templates/COPILOT_INSTRUCTIONS_MEMORY_RULES.md` to the `files` array in `package.json` so they are included in the published npm package per plan.md constitution check (Principle VII)
- [X] T035 [P] Update `README.md` to document the `copilot` command with usage examples, options table, and a link to the Copilot hooks reference
- [X] T036 Run full build and lint cycle: `npm run build && npm run typecheck && npm run lint` and fix any errors
- [X] T037 Run `npx mcp-automem copilot --dry-run` end-to-end and verify output matches contracts/cli-interface.md dry-run output format exactly
- [X] T038 Run `npx mcp-automem copilot --dir /tmp/test-copilot --yes` end-to-end and verify all 3 hook JSON files + 9 support scripts are installed with correct permissions and content. Also verify pre-existing non-AutoMem hook files in the hooks/ directory are untouched after install (per spec edge case: coexistence with other tools)
- [X] T039 Run quickstart.md validation: execute the developer setup steps, build/test cycle, and manual verification commands from `specs/001-copilot-cli-setup/quickstart.md`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **Foundational (Phase 2)**: Depends on Phase 1 (T001 for directory, T002-T003 for types) - BLOCKS all user stories
- **US1 (Phase 3)**: Depends on Phase 2 completion (needs all template files to exist)
- **US2 (Phase 4)**: Depends on Phase 3 (builds on the core installer from US1)
- **US4 (Phase 5)**: Can start after Phase 2 (T029 is independent; T030 depends on US1 T021)
- **US3 (Phase 6)**: Depends on Phase 3 (validates and hardens the --dir path already implemented in US1)
- **Polish (Phase 7)**: Depends on all user stories being complete

### User Story Dependencies

- **User Story 1 (P1)**: Depends on Foundational (Phase 2) - No dependencies on other stories
- **User Story 2 (P2)**: Depends on User Story 1 - extends the installer with format-aware generation
- **User Story 4 (P2)**: Template creation (T029) is independent of US1; post-install message (T030) depends on US1
- **User Story 3 (P3)**: Depends on User Story 1 - validates and hardens the --dir threading

### Within Each User Story

- Types/interfaces before implementation
- Core installer logic before feature variants
- File operations before output/messaging
- Story complete before moving to next priority

### Parallel Opportunities

- Phase 1: T002 and T003 can run in parallel (different type definitions in same file, non-overlapping)
- Phase 2: T005-T006 in parallel (different hook JSON files); T008-T015 all in parallel (different script files)
- Phase 3: T016 must complete before T017-T022; T023-T024 can run in parallel with T017-T022 (different files)
- Phase 5: T029 can run in parallel with any Phase 3 tasks (different file entirely)
- Phase 7: T034 and T035 can run in parallel (different files)

---

## Parallel Example: Phase 2 (Foundational)

```bash
# Launch all support scripts in parallel (independent files):
Task T008: "Create templates/copilot/scripts/capture-build-result.sh"
Task T009: "Create templates/copilot/scripts/capture-test-pattern.sh"
Task T010: "Create templates/copilot/scripts/capture-deployment.sh"
Task T011: "Create templates/copilot/scripts/session-memory.sh"
Task T012: "Create templates/copilot/scripts/python-command.sh"
Task T013: "Create templates/copilot/scripts/queue-cleanup.sh"
Task T014: "Create templates/copilot/scripts/process-session-memory.py"
Task T015: "Create templates/copilot/scripts/memory-filters.json"

# Launch hook JSON files in parallel (after T004):
Task T005: "Create templates/copilot/hooks/automem-post-tool-use.json"
Task T006: "Create templates/copilot/hooks/automem-session-end.json"
```

## Parallel Example: Phase 3 (User Story 1)

```bash
# After T016 (arg parser) completes, these can proceed in parallel:
# Group A (src/cli/copilot.ts - sequential within):
Task T017: "Implement applyCopilotSetup() core installer"
Task T018: "Implement file backup logic" (depends on T017)
Task T019: "Implement --dry-run mode" (depends on T017)

# Group B (src/index.ts - parallel with Group A):
Task T023: "Register copilot command in src/index.ts"
Task T024: "Add copilot help text block"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup (T001-T003)
2. Complete Phase 2: Foundational (T004-T015) - creates all template files
3. Complete Phase 3: User Story 1 (T016-T025) - core installer with default camelCase
4. **STOP and VALIDATE**: Test with `npx mcp-automem copilot --dry-run` and `--dir /tmp/test --yes`
5. Deploy/demo if ready - the default `--format cli` covers the primary audience

### Incremental Delivery

1. Complete Setup + Foundational -> Template files ready
2. Add User Story 1 -> Core installer works -> Deploy/Demo (MVP!)
3. Add User Story 2 -> VS Code format support -> Deploy/Demo
4. Add User Story 4 -> Memory rules template -> Deploy/Demo
5. Add User Story 3 -> Custom dir hardening -> Deploy/Demo
6. Polish -> README, package.json, full validation -> Release

### Single Developer Strategy

Follow phases sequentially: 1 -> 2 -> 3 -> 4 -> 5 -> 6 -> 7. Within each phase, batch parallel tasks where possible. Commit after each completed phase.

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- Each user story should be independently completable and testable
- Commit after each task or logical group
- Stop at any checkpoint to validate story independently
- The existing `claude-code.ts` is the primary reference implementation for patterns (arg parsing, file writing, backup logic, permissions, output formatting)
- Hook JSON templates use Copilot v1 format per research.md R1
- Support scripts must parse JSON from stdin (not env vars) per research.md R3
