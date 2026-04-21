---
name: automem
description: Persistent AutoMem memory via mcporter-exposed AutoMem tools.
user-invocable: true
metadata: {"openclaw":{"skillKey":"automem","primaryEnv":"AUTOMEM_API_KEY","requires":{"env":["AUTOMEM_ENDPOINT"]}}}
---

<!-- automem-template-version: 0.13.0 -->

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

- Recall before answering questions about past decisions, preferences, or similar incidents.
- Store only durable information worth reusing later.
- Use `memory-core` and file-backed workspace memory for local notes and raw transcripts; AutoMem is the semantic cross-session layer.
- If delete targets are ambiguous, show the likely matches and ask for confirmation before deleting.
- Do not fall back to raw curl commands in this mode unless the user explicitly asks for the legacy setup.
