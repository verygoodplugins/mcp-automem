# Implementation Readiness Checklist: Copilot CLI Setup Command

**Purpose**: Validate that spec, plan, contracts, and data model are complete, clear, and consistent enough to code against without ambiguity
**Created**: 2025-07-25
**Feature**: [spec.md](../spec.md) | [plan.md](../plan.md) | [cli-interface.md](../contracts/cli-interface.md) | [data-model.md](../data-model.md)
**Audience**: Author (pre-implementation review)
**Focus Areas**: CLI interface, cross-platform compatibility, hook JSON format, existing-system parity

---

## CLI Interface Completeness

- [ ] CHK001 - Are all five CLI flags (`--format`, `--dir`, `--dry-run`, `--yes`, `--quiet`) specified with types, defaults, aliases, and validation behavior? [Completeness, Spec FR-005 through FR-010, Contract §Options]
- [ ] CHK002 - Is the interaction between `--quiet` and `--dry-run` defined? (Does `--dry-run --quiet` suppress the preview output, making it a no-op?) [Clarity, Gap]
- [ ] CHK003 - Is the behavior when `--yes` is omitted in an interactive terminal specified? (Confirmation prompt content, default answer, timeout?) [Gap, Spec FR-009]
- [ ] CHK004 - Are all three exit code scenarios (success, invalid args, permission error) distinguishable, or do invalid args and permission errors both return code 1? [Clarity, Contract §Exit Codes]
- [ ] CHK005 - Is the `copilot` command's help text content (`--help` output) defined, or only that it should appear in `npx mcp-automem help`? [Completeness, Spec FR-008]
- [ ] CHK006 - Is the argument parsing strategy specified? (e.g., `process.argv` manual parsing, or a library like `commander`/`yargs`, consistent with existing commands?) [Gap, Plan §Technical Context]

## Cross-Platform Compatibility

- [ ] CHK007 - Are the PowerShell script stubs in hook JSON defined with specific content, or only stated as "stubs"? Can an implementer produce the correct stub from the spec alone? [Clarity, Spec §Out of Scope "PowerShell support scripts"]
- [ ] CHK008 - Is the behavior of `--dir` with Windows-style paths (backslashes, drive letters like `C:\Users\`) specified? [Coverage, Spec FR-007]
- [ ] CHK009 - Are file permission requirements (`0755` for scripts) specified with a Windows-equivalent behavior? (`chmod` is no-op on Windows - is that acceptable?) [Consistency, Spec FR-017]
- [ ] CHK010 - Is the line ending convention for generated scripts defined? (LF for bash, CRLF for PowerShell, or platform-native?) [Gap]
- [ ] CHK011 - Are the bash shebang lines for support scripts specified? (`#!/bin/bash` vs `#!/usr/bin/env bash`?) [Gap, Data Model §Support Script]

## Hook JSON Format

- [ ] CHK012 - Is the exact JSON schema for each of the three hook files defined with sufficient detail (field names, nesting, required vs optional fields) to produce byte-accurate output? [Completeness, Data Model §Hook JSON File]
- [ ] CHK013 - Are the `bash` and `powershell` command strings in hook JSON specified with exact content? (e.g., full script paths, argument patterns, stdin piping syntax?) [Clarity, Spec FR-002, FR-003]
- [ ] CHK014 - Is the `timeoutSec` value for each hook type specified, or left to the implementer? [Gap, Data Model §CopilotHookEntry]
- [ ] CHK015 - Are the postToolUse matchers (tool name patterns for bash/powershell) explicitly defined, or must the implementer infer them from the claude-code analogy? [Clarity, Spec FR-003]
- [ ] CHK016 - Is the `type` field for `automem-session-start.json` (`prompt`) vs the other two (`command`) documented with rationale for why session-start uses `prompt` type? [Clarity, Data Model §Files Produced]
- [ ] CHK017 - Does the spec define what the `prompt` type hook returns to Copilot? (The memory recall text that gets injected into context?) [Gap, Spec FR-003]

## Existing-System Parity

- [ ] CHK018 - Is the mapping from each `templates/claude-code/scripts/*` file to its `templates/copilot/scripts/*` counterpart explicitly listed, or must the implementer infer which scripts to adapt? [Completeness, Spec FR-004]
- [ ] CHK019 - Are the specific adaptations needed per script (beyond path remapping from `~/.claude/` to `~/.copilot/`) documented? (e.g., stdin JSON parsing vs env var reading per FR-014?) [Clarity, Spec FR-014]
- [ ] CHK020 - Is the `automem-session-start.sh` script's content defined? The data model says it's "for reference/debugging" but Spec FR-003 says session start performs "memory recall" - are these consistent? [Consistency, Data Model §Support Script vs Spec FR-003]
- [ ] CHK021 - Are the differences between `templates/COPILOT_INSTRUCTIONS_MEMORY_RULES.md` and the existing `templates/CLAUDE_MD_MEMORY_RULES.md` enumerated beyond "adapted for Copilot tool naming"? [Clarity, Spec FR-012, Data Model §Memory Rules Template]

## Acceptance Criteria Quality

- [ ] CHK022 - Can SC-005 ("valid hook JSON that Copilot accepts without errors") be objectively verified without running Copilot? Is "valid" defined against a schema or only runtime acceptance? [Measurability, Spec SC-005]
- [ ] CHK023 - Is SC-001 ("under 30 seconds") measurable in CI, or is it a human-experience goal? Are there specified conditions (cold npm cache, warm cache, network state)? [Measurability, Spec SC-001]
- [ ] CHK024 - Does SC-006 ("no hardcoded `~/.copilot/` references leaking through") define the search scope? (Generated files only, or also the TypeScript source, or both?) [Clarity, Spec SC-006]

## Scenario & Edge Case Coverage

- [ ] CHK025 - Is the behavior defined when `~/.copilot/hooks/` contains an `automem-*.json` file from a DIFFERENT version of mcp-automem? (Backup + overwrite, or version check?) [Coverage, Edge Case]
- [ ] CHK026 - Is the `memory-filters.json` content specified, or must it be inferred from the existing claude-code filter file? [Gap, Data Model §Support Script]
- [ ] CHK027 - Are requirements defined for what happens when `npx mcp-automem queue` is invoked by the session-end hook but the AutoMem service is unreachable? [Coverage, Exception Flow]

## Dependencies & Assumptions

- [ ] CHK028 - Is the assumption that "Copilot CLI and VS Code share `~/.copilot/`" validated against the referenced hooks documentation? [Assumption, Spec §Assumptions]
- [ ] CHK029 - Is the Copilot hooks reference URL (https://docs.github.com/en/copilot/reference/hooks-reference) verified as current, and does the hook v1 format in the data model match its schema? [Dependency, Spec §Dependencies]
- [ ] CHK030 - Is the `package.json` `files` array update (to include `templates/copilot/`) documented as a required change? [Gap, Plan §Project Structure]
