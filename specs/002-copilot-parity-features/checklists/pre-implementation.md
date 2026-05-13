# Pre-Implementation Author Review Checklist: Copilot Parity Features

**Purpose**: Validate that requirements in spec.md and plan.md are complete, clear, consistent, and implementation-ready before coding begins
**Created**: 2025-07-25
**Feature**: [spec.md](../spec.md) | [plan.md](../plan.md)
**Audience**: Author (pre-implementation self-review)
**Depth**: Standard

## Requirement Completeness

- [ ] CHK001 - Are profile definitions (lean vs extras) fully enumerated with exact hook file lists? [Completeness, Spec FR-002/FR-003]
- [ ] CHK002 - Are all six PowerShell scripts individually specified with their expected inputs (env vars) and outputs (JSONL schema)? [Completeness, Spec FR-013/FR-014]
- [ ] CHK003 - Is the uninstall behavior for each artifact type (hook JSON, support scripts, MCP config) individually defined? [Completeness, Spec FR-007/FR-008/FR-009]
- [ ] CHK004 - Are all migrate `--from` source types enumerated beyond `manual`, `none`, and `copilot`? [Gap, Spec FR-010/FR-011]
- [ ] CHK005 - Is the backup strategy for uninstall documented with specific backup location and naming conventions? [Gap, Spec FR-017]
- [ ] CHK006 - Are requirements defined for what happens when spec 001 artifacts are missing or partially installed? [Gap, Dependency]

## Requirement Clarity

- [ ] CHK007 - Is "AutoMem-prefixed hook JSON files" precisely defined - what prefix pattern qualifies a file for removal? [Clarity, Spec FR-007]
- [ ] CHK008 - Is "equivalent output to its bash counterpart" quantified with a specific JSONL field schema? [Clarity, Spec FR-014]
- [ ] CHK009 - Is "clean error message listing valid profiles" specified with exact wording or format? [Clarity, Spec US1-AC5]
- [ ] CHK010 - Are the "scripts directory" and "hooks directory" paths unambiguous across platforms (macOS/Linux/Windows)? [Clarity, Spec FR-007/FR-008]
- [ ] CHK011 - Is "safe degradation" during profile switching defined with measurable criteria (what states are acceptable vs unacceptable)? [Clarity, Spec FR-005]

## Requirement Consistency

- [ ] CHK012 - Are `--dry-run`, `--yes`, `--quiet`, and `--dir` flag behaviors consistent across `copilot`, `uninstall`, and `migrate` commands? [Consistency, Spec FR-016]
- [ ] CHK013 - Does the default profile (`lean`) in the spec align with the plan's profile template structure under `templates/copilot/profiles/`? [Consistency, Spec FR-004, Plan]
- [ ] CHK014 - Are the hook file names in the plan's project structure (e.g., `automem-build.json`) consistent with the spec's profile definitions? [Consistency, Spec FR-002/FR-003, Plan]
- [ ] CHK015 - Is the JSONL queue path (`~/.copilot/scripts/memory-queue.jsonl`) consistent between spec, plan, and clarifications? [Consistency, Spec Key Entities, Plan]

## Acceptance Criteria Quality

- [ ] CHK016 - Can SC-003 ("no residual files remain") be objectively verified - is the complete list of files that constitute "residual" defined? [Measurability, Spec SC-003]
- [ ] CHK017 - Can SC-006 ("same schema as bash counterparts") be verified without referencing the bash implementation - is the schema independently documented? [Measurability, Spec SC-006]
- [ ] CHK018 - Is SC-005 ("same hook installation as running the copilot command directly") testable - are the exact conditions for equivalence defined? [Measurability, Spec SC-005]

## Scenario Coverage

- [ ] CHK019 - Are requirements defined for concurrent execution (two terminals running `copilot --profile` simultaneously)? [Coverage, Gap]
- [ ] CHK020 - Are requirements specified for partial PowerShell script installation (some scripts succeed, some fail)? [Coverage, Exception Flow]
- [ ] CHK021 - Are requirements defined for migrating when existing copilot hooks are a mix of AutoMem and non-AutoMem files? [Coverage, Gap, Spec US4]
- [ ] CHK022 - Is the behavior specified when `--profile lean` is run but the current installation is already `lean`? [Coverage, Spec FR-005]

## Edge Case Coverage

- [ ] CHK023 - Is the behavior defined when the JSONL queue file is locked by another process during PowerShell script write? [Edge Case, Gap]
- [ ] CHK024 - Are requirements specified for hook JSON files with missing or corrupted `powershell` keys during uninstall? [Edge Case, Spec FR-007]
- [ ] CHK025 - Is the behavior defined when `npx` is not on PATH but Node.js is installed (PowerShell script dependency)? [Edge Case, Spec Assumptions]

## Non-Functional Requirements

- [ ] CHK026 - Are performance requirements defined for uninstall/migrate operations (max execution time, file count limits)? [NFR, Gap]
- [ ] CHK027 - Are logging/observability requirements specified for PowerShell scripts beyond "log error to stderr"? [NFR, Spec FR-013a]
- [ ] CHK028 - Are idempotency requirements explicitly stated for all commands (running the same command twice produces the same result)? [NFR, Gap]

## Dependencies & Assumptions

- [ ] CHK029 - Is the assumption that `process-session-memory.py` is cross-platform validated, or does it need verification? [Assumption, Spec Assumptions]
- [ ] CHK030 - Are the exact paths from spec 001 (`~/.copilot/hooks/`, `~/.copilot/mcp-config.json`) confirmed or flagged as "to be confirmed during planning"? [Dependency, Spec Assumptions]

## Notes

- This checklist validates requirement quality for pre-implementation readiness across all four user stories (profiles, PowerShell, uninstall, migrate).
- Items marked [Gap] indicate requirements that may need to be added to spec.md before implementation.
- Items marked [Assumption] indicate claims that should be validated before relying on them in code.
- The existing `requirements.md` checklist covered spec-readiness gates; this checklist goes deeper into implementation-readiness quality.
