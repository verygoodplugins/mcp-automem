# AutoMem Memory Rules for CLAUDE.md

<!-- automem-template-version: 2.0.0 -->

Add this section to your `~/.claude/CLAUDE.md` file. The SessionStart hook will prompt memory recall automatically.

## Quick Installation

```bash
cat templates/CLAUDE_MD_MEMORY_RULES.md >> ~/.claude/CLAUDE.md
```

## Memory Rules Template

Add this to `~/.claude/CLAUDE.md`:

````markdown
<memory_rules>
# AutoMem Memory Rules

TOOL NAMING:
- Claude Code / Claude Desktop expose MCP tools as `mcp__<server>__<tool>` (e.g. `mcp__memory__recall_memory`).
- These examples assume your server name is `memory`.

## Tags Are a Hard Gate — use the existing bare-tag convention

`tags` on `recall_memory` is a *filter*, not a hint. Memories without a matching tag are excluded from results BEFORE scoring — even if they would otherwise be a perfect semantic match.

**The corpus uses BARE tags.** Conventions live in the data:

- `preference`, `bugfix`, `solution`, `decision`, `pattern`, `milestone`, `deployment`, `build`, `test`.
- Project scope is the bare slug: `mcp-automem`, `streamdeck-mcp`. Do NOT prefix with `project/`.
- Language is the bare name: `typescript`, `python`, `go`. No `lang/` prefix.
- Tool / platform / framework is bare: `railway`, `vercel`, `npm`, `pytest`.
- Hierarchical entities the server injects use colons (`entity:people:jack`). Don't author these yourself.

**Why bare, not namespace:** a namespace scheme (`project/<slug>`) silently bifurcates recall against a corpus that uses bare tags — the same project appears under two incompatible filters, and neither query finds everything. Tagging discipline fixes the "hard-gate bite" better than syntactic prefixes do.

### Slug-collision rule

Bare project slugs must not collide with common topic words:
- `streamdeck-mcp` ✓ — unique
- `mcp-automem` ✓ — unique
- `video` ✗ — collides with "video content strategy", "video generation" memories

If a project's natural name is a common word, use a more specific slug (`video-gen-project`) or omit the tag gate for that project and rely on semantic query alone.

### When to gate vs when NOT to

| Intent | Use |
|---|---|
| Pull all memories of a stable well-tagged category | `tags: [<category>], limit: 20+` |
| Scope to a project with a unique slug | `tags: [<slug>]` |
| Discovery / debugging / pre-edit lookup | Semantic `query` only. Do NOT gate on topical tags — tagging discipline is incomplete and hard gates drop relevant memories. |

Do not rely on `context_tags` as a boost right now. Known server quirks: literal string match with no prefix-index consultation, and small `limit` values can drop boosted results before ranking. Use generous `limit` + good semantic `query` instead.

---

## Session Start — Two-Phase Recall (1M-context params)

Run these at session start (the `automem-session-start.sh` hook prompts you; actually execute the calls). Opus 4.7's 1M context lets us use higher limits and a wider time window than the old defaults.

**Phase 1 — Preferences** (tag-only, no time filter, no query):
```
mcp__memory__recall_memory({ tags: ["preference"], limit: 20 })
```

**Phase 2 — Task context** (semantic + project-gated + 90-day window):
```
mcp__memory__recall_memory({
  queries: [<task topic>, "user corrections", "recent decisions"],
  tags: [<project-slug>],
  auto_decompose: true,
  time_query: "last 90 days",
  limit: 30
})
```

**Phase 3 — On-demand debugging** (only when investigating a specific error symptom; NOT routinely at session start):
```
mcp__memory__recall_memory({
  query: <error message or symptom>,
  tags: ["bugfix", "solution"],
  limit: 20
})
```

**Validated tradeoffs** (tested on a production corpus of ~9,400 memories):
- `limit 10→30` and `time_query "last 30 days"→"last 90 days"` compound: 2.5× useful results with zero score-quality loss.
- `auto_decompose: true` is safe; low impact on focused queries, keep it on for multi-topic ones.
- `expand_relations`: no-op on a sparse-association corpus. Leave default; revisit after association authoring discipline is established.

---

## MCP Tools Available

- `store_memory` — save content with tags, importance (0.0–1.0), type, metadata, optional `t_valid` / `t_invalid`
- `recall_memory` — hybrid search (semantic + keyword + tags + time filters)
- `associate_memories` — create typed relationships between memories
- `update_memory` — modify existing memories without duplication
- `delete_memory` — remove by ID
- `check_database_health` — FalkorDB + Qdrant status

### Memory schema

- `importance`: 0.9–1.0 (critical), 0.7–0.8 (important), 0.5–0.6 (standard), <0.5 (minor)
- `type`: `Decision` | `Pattern` | `Preference` | `Style` | `Habit` | `Insight` | `Context`
- `tags`: array of bare strings — see convention above

### Content size

- Target 150–300 chars. One paragraph. "Title. Context. Outcome."
- Soft limit 500 chars (server auto-summarizes beyond).
- Hard limit 2000 chars (rejected).
- For more detail: split into atomic memories + associate.
- Put structured data in `metadata`, not `content`.

---

## Storage Discipline

Every `store_memory` call MUST set `type` and use bare conventional tags.

### Required tags
- One category when applicable: `preference` | `decision` | `pattern` | `bugfix` | `solution` | `milestone` | `deployment` | `build` | `test`.
- Project slug (bare) when project-specific. Omit if too generic (slug-collision rule).

### Storage patterns

User preference (importance 0.9):
```
store_memory({
  content: "User preference: [exact quote]",
  type: "Preference",
  tags: ["preference", <scope>],
  importance: 0.9
})
```

Architectural decision (importance 0.9):
```
store_memory({
  content: "Decided [choice] because [rationale]",
  type: "Decision",
  tags: ["decision", <slug>],
  importance: 0.9
})
```

Bug fix (importance 0.75):
```
store_memory({
  content: "Fixed [issue] in [project]: [solution]. Root cause: [analysis]",
  type: "Insight",
  tags: ["bugfix", "solution", <slug>],
  importance: 0.75
})
```

Feature implementation (importance 0.8):
```
store_memory({
  content: "Implemented [feature] using [approach]",
  type: "Pattern",
  tags: ["pattern", "feature", <slug>],
  importance: 0.8
})
```

### Mandatory association pairings

After storing, create the linked edge. This is where AutoMem becomes a graph vs just a bag of notes.

| Trigger | Store | Then associate |
|---|---|---|
| User correction | `type: Preference`, importance 0.9 | Search old memory → `INVALIDATED_BY` (strength 0.9) |
| Architectural decision | `type: Decision`, importance 0.9 | Find alternatives → `PREFERS_OVER` |
| Bug fix | `type: Insight`, importance 0.75 | Link to bug report → `LEADS_TO` |
| Pattern discovered | `type: Pattern`, importance 0.8 | Link to abstract concept → `EXEMPLIFIES` |
| Knowledge evolved | `update_memory` old + store new | `EVOLVED_INTO` (old → new) |
| Deprecated info | `update_memory` (importance 0.1, `metadata.deprecated: true`) | `INVALIDATED_BY` (old ← new) |

Skip the association only if the related-memory search returns nothing plausible.

### Relationship types

| Type | Use case |
|---|---|
| `LEADS_TO` | Bug → Solution, Problem → Fix |
| `REINFORCES` | Supporting evidence, validation |
| `CONTRADICTS` | Conflicting approaches |
| `EVOLVED_INTO` | Knowledge progression, iterations |
| `INVALIDATED_BY` | Outdated info → current approach |
| `DERIVED_FROM` | Source relationships, origins |
| `RELATES_TO` | General connections |
| `PREFERS_OVER` | User / team preferences |
| `EXEMPLIFIES` | Pattern examples |
| `OCCURRED_BEFORE` | Temporal sequence |
| `PART_OF` | Hierarchical structure |

System/internal relations (`SIMILAR_TO`, `PRECEDED_BY`, `EXPLAINS`, `SHARES_THEME`, `PARALLEL_CONTEXT`, `DISCOVERED`) may appear in recall results but are NOT valid inputs to `associate_memories`.

---

## Temporal Validity

For facts with a shelf life, set `t_valid` (ISO 8601 UTC, usually now) and `t_invalid` when known. These fields are persisted and queryable via `GET /memory/<id>`, though they don't always appear in `/recall` response envelopes.

Use for: current deployment URL, active staging env, incident window, feature-flag rollout, ongoing PR, current sprint focus.

```
store_memory({
  content: "mcp-automem deployed to Railway at https://automem.up.railway.app",
  type: "Context", importance: 0.8,
  tags: ["deployment", "mcp-automem", "production", "railway"],
  t_valid: "<ISO timestamp now>",
  t_invalid: "<ISO timestamp +30 days>"
})
```

---

## Lifecycle: Update > Duplicate

- Before storing a new memory on a topic, do a recall. If a related memory exists, prefer `update_memory` or association over a new node.
- `update_memory` on an old memory: bump `importance`, add to `content` ("Updated: …"), or mark deprecated via `metadata.deprecated: true` + low importance.
- `delete_memory` only for true duplicates or credentials accidentally stored.

### Known server quirk (workaround)

A `store_memory` call can return success while failing to persist in rare cases. After storing anything you care about, do a quick recall with a content-specific query and verify. If not found, retry.

---

## Never Store

- Secrets, credentials, API keys, private tokens.
- Temporary build output, logs, debug dumps.
- Large code blocks (store the pattern or decision instead).
- Ephemeral state that changes every session.
- Duplicate memories (recall first).
</memory_rules>
````
