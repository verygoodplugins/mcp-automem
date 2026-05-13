# Tasks: Copilot Parity Features

**Input**: Design documents from `/specs/002-copilot-parity-features/`
**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/
**Depends On**: Spec 001 (`001-copilot-cli-setup`) - core Copilot hook installer must be implemented and merged first

**Tests**: Test tasks are included since the spec explicitly references Vitest and specifies `npm test` as a gate.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3, US4)
- Include exact file paths in descriptions

## User Story Mapping

| Story | Spec Priority | Title |
|-------|--------------|-------|
| US1 | P1 | Install Copilot Hooks with Profile Selection |
| US2 | P1 | Full PowerShell Support for Windows Users |
| US3 | P2 | Uninstall Copilot Hooks |
| US4 | P3 | Migrate to/from Copilot |

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Create profile template files and shared test utilities that all stories depend on.

- [X] T001 Create `templates/copilot/profiles/lean.json` with hooks list `["automem-session-start.json", "automem-session-end.json"]` per data-model.md profile definition
- [X] T002 [P] Create `templates/copilot/profiles/extras.json` with hooks list `["automem-session-start.json", "automem-build.json", "automem-test.json", "automem-deploy.json", "automem-session-end.json"]` per data-model.md profile definition
- [X] T003 [P] Verify `templates/copilot/profiles/` is included in the `files` array in `package.json` so profile JSON ships with the npm package

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core profile-loading infrastructure that US1, US3, and US4 all depend on.

**CRITICAL**: No user story work can begin until this phase is complete.

- [X] T004 Implement `loadProfile(name: string): ProfileDefinition` utility function in `src/cli/copilot.ts` (or a new `src/cli/copilot-profiles.ts`) that reads `templates/copilot/profiles/{name}.json`, validates the name is `lean` or `extras`, and returns the parsed profile definition. On invalid name, throw with a message listing valid profiles (FR-001, FR-004, acceptance scenario 5).
- [X] T005 [P] Add `--profile <lean|extras>` flag parsing to the copilot command's argument parser in `src/cli/copilot.ts` with default value `lean` (FR-001, FR-004). Wire the parsed value through to the installer.

**Checkpoint**: Profile infrastructure ready - user story implementation can now begin.

---

## Phase 3: User Story 1 - Install Copilot Hooks with Profile Selection (Priority: P1) - MVP

**Goal**: Users can run `npx mcp-automem copilot --profile lean` or `--profile extras` to install exactly the hooks defined by that profile. Default is `lean`.

**Independent Test**: Run `npx mcp-automem copilot --profile lean --dry-run` and verify only session-start and session-end appear. Run with `--profile extras --dry-run` and verify all 5 hooks appear.

### Tests for User Story 1

- [X] T006 [P] [US1] Write unit test in `tests/copilot-profiles.test.ts`: `loadProfile('lean')` returns exactly `["automem-session-start.json", "automem-session-end.json"]`
- [X] T007 [P] [US1] Write unit test in `tests/copilot-profiles.test.ts`: `loadProfile('extras')` returns all 5 hook filenames
- [X] T008 [P] [US1] Write unit test in `tests/copilot-profiles.test.ts`: `loadProfile('invalid')` throws with error message listing valid profiles
- [X] T009 [P] [US1] Write unit test in `tests/copilot-profiles.test.ts`: default profile (no `--profile` flag) resolves to `lean`
- [X] T010 [P] [US1] Write unit test in `tests/copilot-profiles.test.ts`: profile switching from `extras` to `lean` removes extra hooks via remove-first strategy (FR-005)

### Implementation for User Story 1

- [X] T011 [US1] Integrate profile selection into the copilot installer in `src/cli/copilot.ts`: filter the hooks to install based on the loaded profile's `hooks` array. Only copy hook JSON files listed in the profile to the target hooks directory (FR-002, FR-003).
- [X] T012 [US1] Implement remove-first profile switching in `src/cli/copilot.ts`: when hooks already exist, glob for `automem-*.json` in the hooks directory, delete any not in the target profile's list, then install the target set (FR-005). Ensure partial failure leaves fewer hooks (safe degradation).
- [X] T013 [US1] Update `--dry-run` output in `src/cli/copilot.ts` to show which profile is being applied, which hooks will be installed, and which hooks will be removed (if switching profiles).
- [X] T014 [US1] Verify `npm run build` and `npm test` pass with profile changes.

**Checkpoint**: User Story 1 complete. `copilot --profile lean/extras --dry-run` works correctly.

---

## Phase 4: User Story 2 - Full PowerShell Support for Windows Users (Priority: P1)

**Goal**: Windows users get functional `.ps1` scripts that mirror bash script behavior - capturing build, test, deploy, and session events into the JSONL queue.

**Independent Test**: On Windows, trigger a build hook and verify a valid JSONL entry is appended to `~/.copilot/scripts/memory-queue.jsonl`.

### Implementation for User Story 2

- [X] T015 [P] [US2] Create `templates/copilot/scripts/python-command.ps1` - locates Python executable (`python3` or `python`) on PATH, outputs path to stdout, exits 0 with stderr warning if not found. Wrap body in `try { ... } catch { Write-Error "AutoMem hook error: $_"; exit 0 }` per FR-013a
- [X] T016 [P] [US2] Create `templates/copilot/scripts/capture-build-result.ps1` - reads hook context from stdin JSON, detects build commands (npm, make, cargo, etc.), captures build outcome (success/failure, tool, time), appends JSONL entry to `~/.copilot/scripts/memory-queue.jsonl` using `[System.IO.File]::Open()` with `FileShare.None` for atomic writes. Wrap body in `try { ... } catch { Write-Error "AutoMem hook error: $_"; exit 0 }` per FR-013a (FR-013, FR-014, contracts/cli-contract.md)
- [X] T017 [P] [US2] Create `templates/copilot/scripts/capture-test-pattern.ps1` - reads hook context from stdin JSON, detects test commands, captures test results (pass/fail count, patterns), appends JSONL entry to queue. Wrap body in `try { ... } catch { Write-Error "AutoMem hook error: $_"; exit 0 }` per FR-013a (FR-013, FR-014)
- [X] T018 [P] [US2] Create `templates/copilot/scripts/capture-deployment.ps1` - reads hook context from stdin JSON, detects deployment commands, captures deployment details, appends JSONL entry to queue. Wrap body in `try { ... } catch { Write-Error "AutoMem hook error: $_"; exit 0 }` per FR-013a (FR-013, FR-014)
- [X] T019 [P] [US2] Create `templates/copilot/scripts/session-memory.ps1` - processes session context at session end, builds summary memory entry, appends JSONL entry to queue. Wrap body in `try { ... } catch { Write-Error "AutoMem hook error: $_"; exit 0 }` per FR-013a (FR-013, FR-014)
- [X] T020 [P] [US2] Create `templates/copilot/scripts/queue-cleanup.ps1` - deduplicates and archives the JSONL queue file, uses native PS JSON handling (no Python dependency per R6). Wrap body in `try { ... } catch { Write-Error "AutoMem hook error: $_"; exit 0 }` per FR-013a (FR-013, FR-014)
- [X] T021 [US2] Verify all 6 PS scripts include `try/catch` error handling pattern per FR-013a - this is a verification-only task (error handling is embedded in T015-T020)
- [X] T021a [P] [US2] Write unit test in `tests/copilot-powershell.test.ts`: validate that each PS script's JSONL output matches the expected queue entry schema (content, tags, importance, metadata fields) per SC-006
- [X] T021b [P] [US2] Write unit test in `tests/copilot-powershell.test.ts`: validate that installed hook JSON files contain both `bash` and `powershell` keys with correct script paths per SC-004 and spec edge case (dual-key verification)
- [X] T022 [US2] Update hook JSON templates in `templates/copilot/hooks/` to replace PowerShell warning stubs with real `.ps1` script references using `powershell -ExecutionPolicy Bypass -File "$HOME/.copilot/scripts/<script>.ps1"` format (FR-015)
- [X] T023 [US2] Update the copilot installer in `src/cli/copilot.ts` to copy all `.ps1` scripts from `templates/copilot/scripts/` to the target scripts directory alongside the existing `.sh` scripts
- [X] T024 [US2] Verify `templates/copilot/scripts/` is included in the `files` array in `package.json` so PS scripts ship with the npm package

**Checkpoint**: User Story 2 complete. All 6 PS scripts installed, hook JSON references real scripts, JSONL queue format matches bash equivalents.

---

## Phase 5: User Story 3 - Uninstall Copilot Hooks (Priority: P2)

**Goal**: Users can cleanly remove all AutoMem Copilot files with `npx mcp-automem uninstall copilot`.

**Independent Test**: Install hooks, then run `npx mcp-automem uninstall copilot --dry-run` and verify listed files match installation. Run without `--dry-run` and verify all AutoMem files are removed.

### Tests for User Story 3

- [X] T025 [P] [US3] Write unit test in `tests/copilot-uninstall.test.ts`: `uninstall copilot` removes all `automem-*.json` files from hooks directory
- [X] T026 [P] [US3] Write unit test in `tests/copilot-uninstall.test.ts`: `uninstall copilot` removes all AutoMem `.sh` and `.ps1` scripts from scripts directory
- [X] T027 [P] [US3] Write unit test in `tests/copilot-uninstall.test.ts`: `uninstall copilot --clean-all` also removes AutoMem entry from `mcp-config.json`
- [X] T028 [P] [US3] Write unit test in `tests/copilot-uninstall.test.ts`: `uninstall copilot --dry-run` lists files without removing them
- [X] T029 [P] [US3] Write unit test in `tests/copilot-uninstall.test.ts`: `uninstall copilot` when no hooks installed reports "no AutoMem files found" and exits 0

### Implementation for User Story 3

- [X] T030 [US3] Extend `UninstallOptions.platform` union type in `src/cli/uninstall.ts` from `'cursor' | 'claude-code'` to `'cursor' | 'claude-code' | 'copilot'` (data-model.md entity 2)
- [X] T031 [US3] Implement `uninstallCopilot(options: UninstallOptions)` function in `src/cli/uninstall.ts` following the pattern of existing `uninstallCursor()` and `uninstallClaudeCode()`: glob `automem-*.json` in hooks dir, glob AutoMem scripts in scripts dir, create backups, remove files (FR-006, FR-007, FR-008, FR-017)
- [X] T032 [US3] Add `--clean-all` handling to `uninstallCopilot()`: remove AutoMem server entry from `~/.copilot/mcp-config.json` (FR-009). Handle missing config file gracefully (edge case from spec).
- [X] T033 [US3] Wire `uninstallCopilot()` into the platform dispatch in `runUninstall()` in `src/cli/uninstall.ts` - add `else if (options.platform === 'copilot')` branch
- [X] T034 [US3] Update argument parser in `src/cli/uninstall.ts` (`parseUninstallArgs`) to accept `copilot` as a valid platform value and update the usage string from `<cursor|claude-code>` to `<cursor|claude-code|copilot>` (FR-016)
- [X] T035 [US3] Verify `npm run build` and `npm test` pass with uninstall changes.

**Checkpoint**: User Story 3 complete. `uninstall copilot` with all flag combinations works correctly.

---

## Phase 6: User Story 4 - Migrate to/from Copilot (Priority: P3)

**Goal**: Users can migrate to Copilot hook-based setup from other configurations, or from Copilot to other targets.

**Independent Test**: Run `npx mcp-automem migrate --from none --to copilot --dry-run` and verify it shows planned copilot hook installation.

### Tests for User Story 4

- [X] T036 [P] [US4] Write unit test in `tests/copilot-migrate.test.ts`: `migrate --from none --to copilot` delegates to copilot installer
- [X] T037 [P] [US4] Write unit test in `tests/copilot-migrate.test.ts`: `migrate --from manual --to copilot` analyzes manual usage then delegates to copilot installer
- [X] T038 [P] [US4] Write unit test in `tests/copilot-migrate.test.ts`: `migrate --from copilot --to claude-code` analyzes copilot hooks and installs claude-code
- [X] T039 [P] [US4] Write unit test in `tests/copilot-migrate.test.ts`: `migrate --to copilot --dry-run` shows planned changes without modifying files

### Implementation for User Story 4

- [X] T040 [US4] Extend `MigrateOptions.to` union type in `src/cli/migrate.ts` from `'cursor' | 'claude-code'` to `'cursor' | 'claude-code' | 'copilot'` (data-model.md entity 3)
- [X] T041 [US4] Extend `MigrateOptions.from` union type in `src/cli/migrate.ts` from `'manual' | 'none'` to `'manual' | 'none' | 'copilot'` (data-model.md entity 3)
- [X] T042 [US4] Implement `--to copilot` branch in `runMigration()` in `src/cli/migrate.ts`: import and delegate to the copilot installer function (same code path per FR-012), forwarding `--dry-run`, `--yes`, `--quiet` flags
- [X] T043 [US4] Implement `--from copilot` branch in `runMigration()` in `src/cli/migrate.ts`: analyze existing copilot hooks (list installed `automem-*.json`), report findings, then install the target platform
- [X] T044 [US4] Update argument parser in `src/cli/migrate.ts` (`parseMigrateArgs`) to accept `copilot` for both `--from` and `--to` values, and update usage strings (FR-010, FR-011)
- [X] T045 [US4] Verify `npm run build` and `npm test` pass with migrate changes.

**Checkpoint**: User Story 4 complete. Migration to/from copilot works with all flag combinations.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Final validation, documentation, and quality gates.

- [X] T046 [P] Ensure `templates/copilot/scripts/memory-filters.json` is reused from claude-code (symlink or copy) per plan.md structure
- [X] T047 [P] Verify all PS scripts produce JSONL output with the same schema as bash counterparts: `content`, `tags`, `importance`, `type`, `metadata`, `timestamp` fields (FR-014, SC-006)
- [X] T048 [P] Verify hook JSON files reference both `.sh` and `.ps1` scripts via their respective keys so the Copilot CLI runtime selects the correct one per shell (edge case from spec)
- [X] T049 Run full `npm run build` - must pass
- [X] T050 Run full `npm test` - must pass (includes all new test files)
- [X] T051 Run `npm run lint` - must pass
- [X] T052 Run quickstart.md verification scenarios end-to-end per `specs/002-copilot-parity-features/quickstart.md`

---

## Dependencies & Execution Order

### External Dependencies

- **Spec 001** (`001-copilot-cli-setup`): MUST be implemented and merged before any work on this spec begins. Spec 001 delivers the base `copilot` command, hook JSON file structure, bash support scripts, and Copilot directory layout.

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies beyond spec 001 - can start immediately
- **Foundational (Phase 2)**: Depends on Phase 1 (profile files must exist for `loadProfile`)
- **US1 - Profiles (Phase 3)**: Depends on Phase 2 (needs `loadProfile` and `--profile` flag)
- **US2 - PowerShell (Phase 4)**: Depends on Phase 1 only (needs template dirs, independent of profile logic)
- **US3 - Uninstall (Phase 5)**: Depends on Phase 1 only (needs to know which files to remove)
- **US4 - Migrate (Phase 6)**: Depends on Phase 3 (needs copilot installer with profile support to delegate to)
- **Polish (Phase 7)**: Depends on all story phases being complete

### User Story Dependencies

- **US1 (P1 - Profiles)**: Depends on Foundational (Phase 2). No dependencies on other stories.
- **US2 (P1 - PowerShell)**: Depends on Setup (Phase 1) only. **Can run in parallel with US1.**
- **US3 (P2 - Uninstall)**: Depends on Setup (Phase 1) only. **Can run in parallel with US1 and US2** but should be tested after US2 is complete to verify PS script removal.
- **US4 (P3 - Migrate)**: Depends on US1 completion (needs the copilot installer with profile support).

### Within Each User Story

- Tests written first (where applicable), verified to fail before implementation
- Models/types before logic
- Core implementation before integration
- Validation/error handling inline with implementation
- Build + test verification at each checkpoint

### Parallel Opportunities

- T001, T002, T003 (Phase 1 setup) - all parallel
- T004, T005 (Phase 2 foundational) - T005 parallel with T004
- T006-T010 (US1 tests) - all parallel
- T015-T020 (US2 PS scripts) - all parallel (different files, no dependencies)
- T025-T029 (US3 tests) - all parallel
- T036-T039 (US4 tests) - all parallel
- **US1 and US2 can run in parallel** after Phase 2
- **US3 can run in parallel** with US1/US2 after Phase 1

---

## Parallel Example: User Story 2 (PowerShell Scripts)

```text
# All 6 PS scripts can be written simultaneously (different files, no deps):
T015: python-command.ps1
T016: capture-build-result.ps1
T017: capture-test-pattern.ps1
T018: capture-deployment.ps1
T019: session-memory.ps1
T020: queue-cleanup.ps1

# Then sequentially:
T021: Add error handling pattern to all scripts
T022: Update hook JSON templates
T023: Update installer to copy PS scripts
T024: Verify package.json includes scripts
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup (profile template files)
2. Complete Phase 2: Foundational (loadProfile + --profile flag)
3. Complete Phase 3: User Story 1 (profile selection)
4. **STOP and VALIDATE**: Test with `--profile lean --dry-run` and `--profile extras --dry-run`
5. This delivers the core value: users can choose hook density

### Incremental Delivery

1. Phase 1 + Phase 2 -> Foundation ready
2. US1 (Profiles) -> Test independently -> PR-ready increment (MVP!)
3. US2 (PowerShell) -> Test independently -> Windows users get full hook functionality
4. US3 (Uninstall) -> Test independently -> Clean removal path available
5. US4 (Migrate) -> Test independently -> Full parity achieved
6. Phase 7 (Polish) -> Final validation -> Feature complete

### Parallel Team Strategy

With multiple developers after Phase 2 is complete:
- Developer A: US1 (Profiles) - modifies `src/cli/copilot.ts`
- Developer B: US2 (PowerShell) - creates `templates/copilot/scripts/*.ps1`
- Developer C: US3 (Uninstall) - modifies `src/cli/uninstall.ts`
- US4 starts after US1 completes (modifies `src/cli/migrate.ts`)

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- Each user story is independently completable and testable
- Spec 001 is an external hard dependency - no work can start until it is merged
- All PowerShell scripts are queue-only (FR-014) - they never call the AutoMem API directly
- All PowerShell scripts fail silently with exit 0 (FR-013a) - never block user workflow
- Commit after each task or logical group using Conventional Commits format
- Stop at any checkpoint to validate story independently
