---
name: automem
description: Persistent semantic memory via AutoMem (FalkorDB + Qdrant)
version: 1.0.0
requires_env:
  - AUTOMEM_ENDPOINT
optional_env:
  - AUTOMEM_API_KEY
---

# AutoMem — Persistent Semantic Memory

You have persistent memory via AutoMem. Call the HTTP API directly with `curl`.

**IMPORTANT:** Always include the auth header in every request. Do NOT use mcporter, MCP tools, or any other method — just `curl`.

## API Reference

Base URL: `$AUTOMEM_ENDPOINT`

Auth header (include on EVERY request): `-H "Authorization: Bearer $AUTOMEM_API_KEY"`

### Store a Memory

```bash
curl -s -X POST "$AUTOMEM_ENDPOINT/memory" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $AUTOMEM_API_KEY" \
  -d '{
    "content": "Brief title. Context and details. Impact/outcome.",
    "tags": ["project-tag", "topic"],
    "importance": 0.7,
    "metadata": {}
  }'
```

Returns: `{"memory_id": "...", "message": "..."}`

### Recall Memories

```bash
curl -s -H "Authorization: Bearer $AUTOMEM_API_KEY" \
  "$AUTOMEM_ENDPOINT/recall?query=QUERY&limit=5&tags=TAG1&tags=TAG2"
```

Parameters (all optional, use at least `query` or `tags`):

- `query` — semantic search text
- `limit` — max results (default 10)
- `tags` — filter by tags (repeat for multiple)
- `tag_mode` — `any` (default) or `all`
- `time_query` — e.g. `last 7 days`, `today`
- `expand_entities` — `true` for multi-hop reasoning

Returns: `{"results": [{"id": "...", "memory": {"content": "...", "tags": [...], "importance": 0.7}, "final_score": 0.85}], "count": N}`

### Associate Memories

```bash
curl -s -X POST "$AUTOMEM_ENDPOINT/associate" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $AUTOMEM_API_KEY" \
  -d '{
    "memory1_id": "SOURCE_ID",
    "memory2_id": "TARGET_ID",
    "type": "RELATES_TO",
    "strength": 0.8
  }'
```

Types: `RELATES_TO`, `LEADS_TO`, `EVOLVED_INTO`, `DERIVED_FROM`, `INVALIDATED_BY`, `CONTRADICTS`, `REINFORCES`, `PREFERS_OVER`, `PART_OF`, `EXEMPLIFIES`, `OCCURRED_BEFORE`

### Update a Memory

```bash
curl -s -X PATCH "$AUTOMEM_ENDPOINT/memory/MEMORY_ID" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $AUTOMEM_API_KEY" \
  -d '{"importance": 0.9, "tags": ["updated-tag"]}'
```

### Delete a Memory

```bash
curl -s -X DELETE "$AUTOMEM_ENDPOINT/memory/MEMORY_ID" \
  -H "Authorization: Bearer $AUTOMEM_API_KEY"
```

### Health Check (debugging only)

```bash
curl -s -H "Authorization: Bearer $AUTOMEM_API_KEY" "$AUTOMEM_ENDPOINT/health"
```

Only use this when curl calls are failing and you need to diagnose why. Do NOT run on every session start.

### Troubleshooting

- **401 Unauthorized** — You forgot the `-H "Authorization: Bearer $AUTOMEM_API_KEY"` header. Add it to every request.
- **Connection refused** — AutoMem service isn't running. Fall back to file-based memory silently.
- **Empty results** — Try broader query terms, remove tag filters, or increase limit.

---

## Behavioral Rules

### Session Start — Recall First

Before responding to the first real message in a new session, recall relevant context:

```bash
curl -s -H "Authorization: Bearer $AUTOMEM_API_KEY" \
  "$AUTOMEM_ENDPOINT/recall?query=SUMMARIZE_CURRENT_TOPIC&limit=5"
```

**ALWAYS recall for:**

- Questions about past decisions, preferences, or history
- Anything the human has told you before ("remember I like...", "we decided...")
- Debugging or troubleshooting (search for similar past issues)
- Project planning or architecture discussions

**Skip recall ONLY for:**

- Simple greetings or small talk
- Questions answerable from general knowledge
- Reading a file or running a command (just do it)

**Natural integration:** Use recalled context as if you've always known it. Don't say "I found in my memory that..." — just use the information naturally.

### During Conversation — Store What Matters

| Category | Importance | Examples |
|----------|-----------|---------|
| Decisions | 0.9 | "Chose Railway over Fly.io for deployment. Reason: persistent volumes." |
| User corrections | 0.8 | "Human prefers dark mode themes. Corrected my light mode suggestion." |
| Bug fixes | 0.8 | "WhatsApp webhook failing. Root cause: expired token. Solution: auto-refresh." |
| Preferences | 0.7 | "Human likes terse responses, no fluff." |
| Patterns | 0.7 | "Use early returns for validation in all API routes." |
| Context | 0.5 | "Set up new Telegram channel for family group." |

**Content format:** `Brief title. Context and details. Impact/outcome.` (150-300 chars, max 500)

**What NOT to store:** Trivial changes (typos, formatting), secrets/API keys, info already in daily memory files.

### Tagging Convention

Always include at least:

1. A project/user identifier tag
2. A topic-specific tag (e.g., `whatsapp`, `deployment`, `preference`)

### Linking Related Memories

When a new memory relates to an existing one, associate them:

- Bug fix → original issue: `DERIVED_FROM`
- New decision → old decision: `EVOLVED_INTO` or `INVALIDATED_BY`
- User correction → what was corrected: `INVALIDATED_BY`

### Memory Layers

| Layer | Storage | Purpose | Scope |
|-------|---------|---------|-------|
| Daily files (`memory/YYYY-MM-DD.md`) | Local filesystem | Raw session logs | Single workspace |
| MEMORY.md | Local filesystem | Curated long-term notes | Single workspace |
| **AutoMem** (this skill) | FalkorDB + Qdrant | **Semantic graph memory** | **All sessions, all platforms** |

Use all three. Daily files for raw logs. MEMORY.md for curated notes. AutoMem for everything that should persist and be searchable across sessions.

### Heartbeat Memory Maintenance

During heartbeat checks, periodically:

1. Review recent `memory/YYYY-MM-DD.md` files
2. Store significant events in AutoMem for long-term semantic recall

### Error Handling

If AutoMem is unavailable (curl fails):

- Continue normally — memory enhances but never blocks
- Don't announce failures to the human
- Fall back to file-based memory
- Only check `/health` endpoint to diagnose persistent failures

### Built-in Memory Plugins

The `memory-lancedb` plugin is NOT needed when AutoMem is configured. AutoMem handles embeddings server-side — no OpenAI/Google API keys required. Ignore any "disabled" status for built-in `memory_search`/`memory_get` tools.
