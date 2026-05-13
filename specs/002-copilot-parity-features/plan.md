# Implementation Plan: Copilot Parity Features

**Branch**: `002-copilot-parity-features` | **Date**: 2025-07-25 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `specs/002-copilot-parity-features/spec.md`
**Depends On**: Spec 001 (`001-copilot-cli-setup`) - core Copilot hook installer

## Summary

Bring the `copilot` CLI command to feature-complete parity with `claude-code` by adding: (1) hook profiles (`--profile lean|extras`) controlling which hook JSON files are installed, (2) full PowerShell `.ps1` equivalents of all bash hook/support scripts for Windows users, (3) `copilot` as a target for the `uninstall` command, and (4) `copilot` as a `--to`/`--from` target for the `migrate` command. All new code follows existing patterns in `src/cli/uninstall.ts`, `src/cli/migrate.ts`, and `templates/claude-code/`.

## Technical Context

**Language/Version**: TypeScript (ES modules, `"type": "module"`) compiled via `tsc`
**Primary Dependencies**: Node.js (^20.19.0 || ^22.13.0 || >=24), `@modelcontextprotocol/sdk`, `fs`, `os`, `path` (stdlib)
**Storage**: Filesystem only - JSONL queue at `~/.copilot/scripts/memory-queue.jsonl`, hook JSON files in `~/.copilot/hooks/`
**Testing**: Vitest (`npm test` for unit, `npm run test:integration` for integration)
**Target Platform**: macOS, Linux, Windows (cross-platform)
**Project Type**: CLI (npm package `@verygoodplugins/mcp-automem`)
**Build**: `npm run build` (runs `tsc`)
**Constraints**: Hook scripts must never block user workflow (fail silently, exit 0). PS scripts are queue-only (no direct API calls).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. MCP Protocol Fidelity | PASS | No MCP changes; hooks queue JSONL, drained via existing `queue` command |
| II. Conventional Commits | PASS | All commits will follow format; PR title will be `feat: add copilot parity features` |
| III. TypeScript Compilation | PASS | All new TS code in `src/`, builds via `tsc`, tests via Vitest |
| IV. CLI-First UX | PASS | Extends existing CLI commands (`copilot`, `uninstall`, `migrate`); `--dry-run` on all |
| V. Cross-Platform | PASS | Core deliverable - adding PowerShell scripts alongside bash scripts |
| VI. Template-Driven Config | PASS | Profile templates under `templates/copilot/profiles/`, parallel to claude-code |
| VII. Open Source Stewardship | PASS | No secrets; MIT licensed; templates in `package.json` `files` array |

**Result: ALL GATES PASS** - no violations requiring justification.

## Project Structure

### Documentation (this feature)

```text
specs/002-copilot-parity-features/
├── plan.md              # This file
├── research.md          # Phase 0: research findings
├── data-model.md        # Phase 1: entity definitions
├── quickstart.md        # Phase 1: verification guide
├── contracts/           # Phase 1: CLI interface contracts
│   └── cli-contract.md  # CLI flags, exit codes, output format
└── tasks.md             # Phase 2: task list (created by /speckit.tasks)
```

### Source Code (repository root)

```text
src/
└── cli/
    ├── copilot.ts           # NEW - Copilot hook installer with profile support (spec 001 delivers this)
    ├── uninstall.ts         # MODIFY - Add 'copilot' platform target
    └── migrate.ts           # MODIFY - Add 'copilot' as --to/--from value

templates/
└── copilot/
    ├── hooks/               # Hook JSON files (delivered by spec 001)
    │   ├── automem-session-start.json
    │   ├── automem-session-end.json
    │   ├── automem-build.json
    │   ├── automem-test.json
    │   └── automem-deploy.json
    ├── scripts/             # Support scripts
    │   ├── capture-build-result.ps1    # NEW - PS equivalent of bash script
    │   ├── capture-test-pattern.ps1    # NEW - PS equivalent of bash script
    │   ├── capture-deployment.ps1      # NEW - PS equivalent of bash script
    │   ├── session-memory.ps1          # NEW - PS equivalent of bash script
    │   ├── queue-cleanup.ps1           # NEW - PS equivalent of bash script
    │   ├── python-command.ps1          # NEW - PS equivalent of bash script
    │   └── memory-filters.json         # REUSE from claude-code
    └── profiles/
        ├── lean.json        # NEW - Profile definition: session-start + session-end only
        └── extras.json      # NEW - Profile definition: all hooks

tests/
├── copilot-profiles.test.ts    # NEW - Profile selection unit tests
├── copilot-uninstall.test.ts   # NEW - Uninstall copilot target tests
└── copilot-migrate.test.ts     # NEW - Migrate copilot target tests
```

**Structure Decision**: Extends existing single-project structure. New TypeScript goes in `src/cli/`, new templates in `templates/copilot/`, new tests in `tests/`. Parallels the established `templates/claude-code/` layout.

## Complexity Tracking

No violations to justify - all gates pass.
