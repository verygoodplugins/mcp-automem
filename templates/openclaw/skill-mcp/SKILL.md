---
name: automem
description: Persistent AutoMem memory via mcporter-exposed AutoMem tools.
user-invocable: true
metadata: {"openclaw":{"skillKey":"automem","primaryEnv":"AUTOMEM_API_KEY","requires":{"env":["AUTOMEM_API_URL"]}}}
---

<!-- automem-template-version: 0.14.0 -->

# AutoMem

Use the typed AutoMem tools exposed through `mcporter`.

## Natural language mappings

- `remember ...` or `store this` -> `automem_store_memory`
- `what do you know about ...` or `recall ...` -> `automem_recall_memory`
- `update memory ...` -> `automem_update_memory`
- `delete memory ...` -> recall first when needed, then `automem_delete_memory`
- `link these memories ...` -> `automem_associate_memories`
- `is memory healthy?` -> `automem_check_health`

## Slash command behavior

Interpret `/automem remember ...`, `/automem recall ...`, `/automem update ...`, and `/automem delete ...` as requests to use the matching AutoMem tool flow.

## Rules

- Recall preferences first with `tags: ["preference"]`, `sort: "updated_desc"`, and `format: "detailed"` when collaboration style or user habits matter.
- For task context, prefer one semantic query built from the user's actual nouns. Do not hard-gate recall with default tags unless the conversation is clearly scoped to an unambiguous project slug.
- For debugging, use a tighter recall on the symptom with `tags: ["bugfix", "solution"]`.
- Tags are a hard gate. Use bare tags only, and avoid platform tags like `openclaw`.
- Store only durable information worth reusing later.
- Default project tags are for stored memories. Recall should stay semantic unless tags are explicitly needed.
- Use `memory-core` and file-backed workspace memory for local notes and raw transcripts; AutoMem is the semantic cross-session layer.
- If delete targets are ambiguous, show the likely matches and ask for confirmation before deleting.
- Do not fall back to raw curl commands in this mode unless the user explicitly asks for the legacy setup.
