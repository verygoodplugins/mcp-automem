---
name: automem
description: Persistent AutoMem memory via the legacy curl-based AutoMem skill.
requires_env:
  - AUTOMEM_ENDPOINT
optional_env:
  - AUTOMEM_API_KEY
user-invocable: true
metadata: {"openclaw":{"skillKey":"automem","primaryEnv":"AUTOMEM_API_KEY","requires":{"env":["AUTOMEM_ENDPOINT"]}}}
---

<!-- automem-template-version: 2.0.0 -->

# AutoMem Legacy Skill

This mode uses direct HTTP calls with `curl`.

## API usage

Base URL: `$AUTOMEM_ENDPOINT`

Store memory:

```bash
curl -s -X POST "$AUTOMEM_ENDPOINT/memory" \
  -H "Content-Type: application/json" \
  ${AUTOMEM_API_KEY:+-H "Authorization: Bearer $AUTOMEM_API_KEY"} \
  -d '{
    "content": "Brief title. Context and details. Impact/outcome.",
    "tags": ["openclaw"],
    "importance": 0.7
  }'
```

Recall memory:

```bash
curl -s \
  ${AUTOMEM_API_KEY:+-H "Authorization: Bearer $AUTOMEM_API_KEY"} \
  "$AUTOMEM_ENDPOINT/recall?query=QUERY&limit=5"
```

Update memory:

```bash
curl -s -X PATCH "$AUTOMEM_ENDPOINT/memory/MEMORY_ID" \
  -H "Content-Type: application/json" \
  ${AUTOMEM_API_KEY:+-H "Authorization: Bearer $AUTOMEM_API_KEY"} \
  -d '{"content":"Updated context."}'
```

Delete memory:

```bash
curl -s -X DELETE "$AUTOMEM_ENDPOINT/memory/MEMORY_ID" \
  ${AUTOMEM_API_KEY:+-H "Authorization: Bearer $AUTOMEM_API_KEY"}
```

## Rules

- Recall before answering questions about prior decisions, preferences, or debugging history.
- Store durable outcomes only.
- If delete targets are ambiguous, recall likely matches first and ask for confirmation before deleting.
- Use `memory-core` and local memory files alongside AutoMem when file-backed notes are useful.
- Only call `/health` when AutoMem requests are failing and you need to debug the connection.
