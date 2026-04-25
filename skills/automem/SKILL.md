---
name: automem
description: Persistent AutoMem memory via the native AutoMem OpenClaw plugin tools.
user-invocable: true
metadata: {"openclaw":{"skillKey":"automem"}}
---

<!-- automem-template-version: 0.14.0 -->

# AutoMem

Use the native AutoMem tools exposed by the AutoMem plugin.

## Natural language mappings

- `remember ...` or `store this` -> call `automem_store_memory`
- `what do you know about ...` or `recall ...` -> call `automem_recall_memory`
- `update memory ...` -> call `automem_update_memory`
- `delete memory ...` -> recall first when needed, then call `automem_delete_memory`
- `link these memories ...` -> call `automem_associate_memories`
- `is memory healthy?` -> call `automem_check_health`

## Slash command behavior

Treat `/automem remember ...`, `/automem recall ...`, `/automem update ...`, and `/automem delete ...` as direct requests to use the matching AutoMem tool flow above.

## Rules

- Recall first for prior decisions, preferences, ongoing projects, and debugging history.
- Store durable outcomes: decisions, bug fixes, patterns, preferences, and important context.
- Keep content compact: `Brief title. Context and details. Impact/outcome.`
- If deletion is ambiguous, recall candidates first and ask for confirmation with ids before deleting.
- Use `memory-core` alongside AutoMem when file-backed workspace memory is helpful. It complements AutoMem; it is not a replacement.
