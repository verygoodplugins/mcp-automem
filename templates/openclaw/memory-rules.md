<!-- BEGIN AUTOMEM OPENCLAW RULES -->
<!-- automem-template-version: 1.1.0 -->

## AutoMem — Your Persistent Semantic Memory

> **You already have persistent memory.** AutoMem is configured and available via the **mcporter** skill. You do NOT need OpenAI, Google, or any other API keys — AutoMem handles embeddings server-side.

### Setup Status — Verify on First Session

Before responding to any user message in a new session, confirm AutoMem is online:

```bash
mcporter call {{MCPORTER_SERVER}}.check_database_health
```

If this returns a healthy status → you're good. Use AutoMem for all memory operations.
If it fails → fall back to file-based memory silently. Do not mention the failure to the user.

### What AutoMem Is (and What It Replaces)

- **mcporter** is a bundled OpenClaw skill (verify: `openclaw skills check mcporter`). It is already installed. Use `mcporter call {{MCPORTER_SERVER}}.*` commands directly.
- **AutoMem** uses FalkorDB (graph) + Qdrant (vectors) for hybrid semantic search. It persists across all sessions, platforms, and gateway restarts.
- **The `memory-lancedb` plugin is NOT needed** when AutoMem is configured. Ignore any "disabled" status for built-in `memory_search` / `memory_get` tools — those require client-side API keys you don't need. AutoMem replaces them entirely.

### Memory Layers

| Layer | Storage | Purpose | Scope |
|-------|---------|---------|-------|
| Daily files (`memory/YYYY-MM-DD.md`) | Local filesystem | Raw session logs | Single workspace |
| MEMORY.md | Local filesystem | Curated long-term notes | Single workspace |
| **AutoMem** (via mcporter) | FalkorDB + Qdrant | **Semantic graph memory** | **All sessions, all platforms** |

Use all three. Daily files for raw logs. MEMORY.md for curated notes. AutoMem for everything that should persist and be searchable.

### Every Session — Recall First

Before responding to the first real message, recall relevant context:

```bash
mcporter call {{MCPORTER_SERVER}}.recall_memory query="<summarize current topic or question>" limit:5
```

**ALWAYS recall for:**
- Questions about past decisions, preferences, or history
- Anything the human has told you before ("remember I like...", "we decided...")
- Debugging or troubleshooting (search for similar past issues)
- Project planning or architecture discussions
- Anything where historical context would improve your answer

**Skip recall ONLY for:**
- Simple greetings or small talk
- Questions you can answer from general knowledge
- Reading a file or running a command (just do it)

**Natural integration:** Use recalled context as if you've always known it. Don't say "I found in my memory that..." — just use the information naturally.

### During Conversation — Store What Matters

When something important happens, store it:

```bash
mcporter call {{MCPORTER_SERVER}}.store_memory \
  content="Brief title. Context and details. Impact/outcome." \
  importance:0.7 \
  tags='["{{PROJECT_NAME}}","<topic>"]'
```

**What to store (with importance levels):**

| Category | Importance | Examples |
|----------|-----------|---------|
| Decisions | 0.9 | "Chose Railway over Fly.io for deployment. Reason: persistent volumes." |
| User corrections | 0.8 | "Human prefers dark mode themes. Corrected my light mode suggestion." |
| Bug fixes | 0.8 | "WhatsApp webhook failing. Root cause: expired token. Solution: auto-refresh." |
| Preferences | 0.7 | "Human likes terse responses, no fluff." |
| Patterns | 0.7 | "Use early returns for validation in all API routes." |
| Context | 0.5 | "Set up new Telegram channel for family group." |

**What NOT to store:**
- Trivial changes (typos, formatting)
- Secrets, API keys, passwords (never!)
- Information already in daily memory files (avoid duplication)
- Anything you'd forget by tomorrow anyway

**Content format:** `Brief title. Context and details. Impact/outcome.`
- Target: 150-300 characters
- Maximum: 500 characters
- If longer, split into multiple memories and associate them

**Memory types** (optional `type` parameter):
- `Decision` — strategic or technical choices
- `Insight` — root cause discoveries, key learnings
- `Pattern` — reusable approaches, best practices
- `Preference` — user preferences, corrections
- `Context` — general information (default)

### Tagging Convention

Always include:
1. `{{PROJECT_NAME}}` — project/user identifier
2. Topic tag — specific area (e.g., `whatsapp`, `cron`, `heartbeat`, `preference`)

### Heartbeat Memory Maintenance

During heartbeat checks, periodically (every few days):
1. Review recent `memory/YYYY-MM-DD.md` files
2. Store significant events in AutoMem for long-term semantic recall
3. This bridges your file-based daily logs with durable cross-session memory

```bash
mcporter call {{MCPORTER_SERVER}}.store_memory \
  content="<distilled insight from daily notes>" \
  importance:0.6 \
  tags='["{{PROJECT_NAME}}","heartbeat-digest"]'
```

### Linking Related Memories

When a new memory relates to an existing one, associate them:

```bash
mcporter call {{MCPORTER_SERVER}}.associate_memories \
  memory1_id="<first-id>" \
  memory2_id="<second-id>" \
  type="RELATES_TO" \
  strength:0.8
```

Association types: `RELATES_TO`, `LEADS_TO`, `EVOLVED_INTO`, `DERIVED_FROM`, `INVALIDATED_BY`, `CONTRADICTS`, `REINFORCES`, `PREFERS_OVER`, `PART_OF`

Common patterns:
- Bug fix → original issue: `DERIVED_FROM`
- New decision → old decision: `EVOLVED_INTO` or `INVALIDATED_BY`
- User correction → what was corrected: `INVALIDATED_BY`

### Advanced Recall

```bash
# Search with tags
mcporter call {{MCPORTER_SERVER}}.recall_memory \
  query="deployment issues" \
  tags='["{{PROJECT_NAME}}"]' \
  limit:5

# Recent memories only
mcporter call {{MCPORTER_SERVER}}.recall_memory \
  query="what we discussed" \
  time_query="last 7 days" \
  limit:5

# Multi-hop reasoning (finds connected memories)
mcporter call {{MCPORTER_SERVER}}.recall_memory \
  query="what does the human's sister do?" \
  expand_entities:true
```

### Error Handling

If mcporter or AutoMem is unavailable:
- Continue normally — memory enhances but never blocks
- Don't announce failures to the human
- Fall back to file-based memory

---

**Installed**: `npx @verygoodplugins/mcp-automem openclaw`
**mcporter server**: `{{MCPORTER_SERVER}}`
**Project**: {{PROJECT_NAME}}

<!-- END AUTOMEM OPENCLAW RULES -->
