# Implementation Plan: Copilot CLI Setup Command

**Branch**: `001-copilot-cli-setup` | **Date**: 2025-07-24 | **Spec**: [specs/001-copilot-cli-setup/spec.md](spec.md)
**Input**: Feature specification from `specs/001-copilot-cli-setup/spec.md`

## Summary

Add a `npx mcp-automem copilot` CLI command that installs AutoMem hook JSON files, support scripts, and a memory rules template into `~/.copilot/` for GitHub Copilot (CLI and VS Code). The command follows the established pattern from `src/cli/claude-code.ts` but differs in three key ways: (1) hook files are standalone JSON (Copilot v1 format) instead of settings.json merge, (2) Copilot delivers JSON payloads on stdin rather than via environment variables, and (3) a `--format cli|vscode` flag controls event name casing (camelCase vs PascalCase).

## Technical Context

**Language/Version**: TypeScript (ES modules, `"type": "module"`) compiled via `tsc`
**Primary Dependencies**: Node.js built-ins (`fs`, `os`, `path`, `child_process`), no new deps
**Storage**: Filesystem only - JSON hook files, shell scripts, markdown templates
**Testing**: Vitest (`npm test` for unit, `npm run test:integration` for integration)
**Target Platform**: macOS, Linux, Windows (cross-platform via `os.homedir()`)
**Project Type**: CLI (npm package with `npx` execution)
**Performance Goals**: Installation completes in under 1 second (small file writes)
**Constraints**: No network access required; must work offline
**Scale/Scope**: 3 hook JSON files + adapted support scripts + 1 memory rules template

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| # | Principle | Status | Evidence |
|---|-----------|--------|----------|
| I | MCP Protocol Fidelity | N/A | CLI installer, not MCP tool |
| II | Conventional Commits | PASS | PR title will follow `feat: add copilot setup command` |
| III | TypeScript Compilation Discipline | PASS | New code in `src/cli/copilot.ts`, builds via `tsc` |
| IV | CLI-First User Experience | PASS | New CLI subcommand with `--dry-run`, `--yes`, `--quiet`, `--format`, `--dir` |
| V | Cross-Platform Compatibility | PASS | `os.homedir()` for path resolution; hooks include `bash` + `powershell` keys |
| VI | Template-Driven Configuration | PASS | Dedicated `templates/copilot/` directory with hook JSON + scripts |
| VII | Open Source Stewardship | PASS | No secrets; templates in `files` array for npm publish |

**Gate result: PASS** - No violations.

## Project Structure

### Documentation (this feature)

```text
specs/001-copilot-cli-setup/
├── plan.md              # This file
├── research.md          # Phase 0: Copilot hooks format research
├── data-model.md        # Phase 1: Entity definitions
├── quickstart.md        # Phase 1: Developer quickstart
├── contracts/           # Phase 1: CLI interface contract
│   └── cli-interface.md
└── tasks.md             # Phase 2: Task list (created by /speckit.tasks)
```

### Source Code (repository root)

```text
src/
└── cli/
    └── copilot.ts               # NEW: Copilot setup command handler

templates/
├── copilot/                     # NEW: Copilot template directory
│   ├── hooks/                   # NEW: Standalone hook JSON files (v1 format)
│   │   ├── automem-session-start.json
│   │   ├── automem-post-tool-use.json
│   │   └── automem-session-end.json
│   └── scripts/                 # NEW: Adapted support scripts
│       ├── automem-session-start.sh
│       ├── capture-build-result.sh
│       ├── capture-test-pattern.sh
│       ├── capture-deployment.sh
│       ├── session-memory.sh
│       ├── python-command.sh
│       ├── queue-cleanup.sh
│       ├── process-session-memory.py
│       └── memory-filters.json
└── COPILOT_INSTRUCTIONS_MEMORY_RULES.md  # NEW: Memory rules template

tests/
└── copilot-setup.test.ts        # NEW: Unit tests
```

**Structure Decision**: Single project structure, following the established pattern of one CLI module per platform (`claude-code.ts`, `codex.ts`, `cursor.ts`, `openclaw.ts`) with a corresponding `templates/<platform>/` directory.

## Complexity Tracking

No violations to justify.
