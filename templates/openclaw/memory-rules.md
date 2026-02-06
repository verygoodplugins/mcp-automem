<!-- BEGIN AUTOMEM OPENCLAW RULES -->
<!-- automem-template-version: 1.0.0 -->

## Persistent Memory (AutoMem)

You have access to a **persistent graph-vector memory** via mcporter. This is separate from your file-based daily memory — use both.

- **Daily files** (`memory/YYYY-MM-DD.md`) → raw session logs, ephemeral
- **MEMORY.md** → curated long-term notes, local to this workspace
- **AutoMem** → semantic memory that persists across all sessions, platforms, and devices

AutoMem uses FalkorDB (graph) + Qdrant (vectors) for hybrid search. It survives gateway restarts and syncs everywhere.

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

### Health Check

```bash
mcporter call {{MCPORTER_SERVER}}.check_database_health
```

---

**Installed**: `npx @verygoodplugins/mcp-automem openclaw`
**mcporter server**: `{{MCPORTER_SERVER}}`
**Project**: {{PROJECT_NAME}}

<!-- END AUTOMEM OPENCLAW RULES -->
