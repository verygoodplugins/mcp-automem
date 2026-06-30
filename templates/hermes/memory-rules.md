<!-- BEGIN AUTOMEM HERMES RULES -->
<!-- automem-template-version: 0.15.0 -->
# Memory - AutoMem for Hermes

AutoMem is installed for Hermes in this project (`{{PROJECT_NAME}}`). Use it proactively for durable memory, not as a passive reference lookup.

{{HERMES_MODE_RULES}}

## Storage Discipline

- Store corrections immediately when the user corrects a durable preference, naming, approach, or factual claim.
- Store decisions when the user settles a direction that affects future work.
- Store articulated patterns when the user says they always do something or wants a recurring behavior preserved.
- Do not store secrets, credentials, tokens, PII, session summaries, progress reports, or attentiveness notes.
- Use bare tags such as `automem`, `hermes`, `typescript`, `bugfix`, `decision`, and `preference`.
- Prefer current repository evidence over recalled memory when they conflict.
<!-- END AUTOMEM HERMES RULES -->
