# AutoMem Memory Rules for Copilot

<!-- automem-template-version: 0.14.0 -->

Add this section to your `~/.copilot/copilot-instructions.md` file for GitHub Copilot. The SessionStart hook will prompt memory recall automatically.

## Quick Installation

```bash
cat templates/COPILOT_INSTRUCTIONS_MEMORY_RULES.md >> ~/.copilot/copilot-instructions.md
```

## Copilot Memory Rules Template

Add this to `~/.copilot/copilot-instructions.md`:

````markdown
<memory_rules>
# AutoMem Memory Rules

TOOL NAMING:
- Copilot CLI exposes MCP tools as `<server>-<tool>` (e.g. `automem-recall_memory`).
- VS Code Copilot exposes MCP tools as `mcp_<server>_<tool>` (e.g. `mcp_automem_recall_memory`).
- These examples use the CLI format (`automem-<tool>`). Substitute as needed for VS Code.

---

## Tool's real behavior (validated against production corpus)

- **Tags are a hard gate** - memories without a matching tag are excluded before scoring. Useful when you genuinely want a category (`preference`, `bugfix`); harmful when you're guessing a project slug.
- **`auto_decompose: true` with template queries hurts focused recalls.** Sub-queries converge on the same top scorers, dedup strips them, residuals don't clear threshold. Keep it off by default; turn it on only for genuinely multi-topic questions.
- **`limit` caps at 50.** Anything under 15 is throwing away context budget you have.
- **`format: "detailed"`** gives timestamps, confidence, importance, and relations inline. Default `text` hides all of it. Use detailed when you need to judge staleness.
- **`expand_relations: true` breaks under tag gates** - server re-applies the filter to expansion targets. If you want graph traversal, drop the tag.
- **`store_memory` can silently fail** (returns success, doesn't persist). After storing anything you care about, recall it back with a distinctive phrase to verify. Retry if gone.
- **Bare tag convention** - `automem`, not `project/automem`. Older memories use `project/<slug>` prefixes, so tag-gated queries on slugs can miss historical content. When a gate returns sparse, retry without it. `entity:people:*`-style tags are server-injected - don't author them.

### Slug-collision rule

Bare project slugs must not collide with common topic words:
- `streamdeck-mcp` - unique
- `mcp-automem` - unique
- `video` - collides with "video content strategy", "video generation" memories

If a project's natural name is a common word, use a more specific slug (`video-gen-project`) or omit the tag gate for that project and rely on semantic query alone.

### When to gate vs when NOT to

| Intent | Use |
|---|---|
| Pull all memories of a stable well-tagged category | `tags: [<category>], limit: 20+` |
| Scope to a project with a unique slug | `tags: [<slug>]` |
| Discovery / debugging / pre-edit lookup | Semantic `query` only. Do NOT gate on topical tags. |

Do not rely on `context_tags` as a boost right now. Known server quirks: literal string match with no prefix-index consultation, and small `limit` values can drop boosted results before ranking. Use generous `limit` + good semantic `query` instead.

---

## Session Start - Two-Phase Recall (1M-context params)

Run these at session start (the SessionStart hook prompts you; actually execute the calls).

**Phase 1 - Preferences** (tag-only, no time filter, no query):
```
automem-recall_memory({
  tags: ["preference"],
  limit: 20,
  sort: "updated_desc",
  format: "detailed"
})
```

No query, no time gate. Sort by `updated_desc` so the freshest preferences win; `format: "detailed"` surfaces timestamps/confidence/importance inline so you can judge staleness at a glance.

**Phase 2 - Task context** (single semantic query built from content nouns + project-slug gate + 90-day window):
```
automem-recall_memory({
  query: "<proper nouns, specific tools, exact topics from the user's message>",
  tags: [<project-slug>],
  time_query: "last 90 days",
  limit: 30,
  format: "detailed"
})
```

How to write the query:
- Use the specific things named. "AutoMem Discord bot Railway deploy" beats "current project status."
- Proper nouns are gold - people, products, places.
- Tools mentioned = include them (Railway, Vercel, pytest, etc.).
- Skip meta words. "Recent," "decisions," "corrections" water down the embedding.
- Code context: add `language: "typescript"` / `"python"` as a _ranker_ (boosts in-language memories, doesn't gate them).

Gate by the working-directory-derived project slug when it's unambiguous (see slug-collision rule); drop the gate otherwise. **Use `queries[]` + `auto_decompose: true` only for genuinely multi-topic questions** - the empirical default is one good query.

**Phase 3 - On-demand debugging** (only when actively investigating a specific error symptom):
```
automem-recall_memory({
  query: "<error message or symptom>",
  tags: ["bugfix", "solution"],
  limit: 20
})
```

Don't re-recall mid-conversation unless the topic genuinely shifts. With 1M context, memories pulled on turn 1 are still in scope - burning another recall on turn 4 of the same thread is waste.

---

## MCP Tools Available

- `store_memory` - save content with tags, importance (0.0-1.0), type, metadata, optional `t_valid` / `t_invalid`. Supports **batch mode** via `memories: [...]` (up to 500 items).
- `recall_memory` - three modes:
  - **ID fetch:** `memory_id` (ignores other params)
  - **Tag enumeration:** `tags` + `exhaustive: true` (paginated, exact-match, returns `has_more`)
  - **Ranked retrieval (default):** hybrid search; supports `exclude_tags` to scope out tag namespaces
- `associate_memories` - create typed relationships between memories
- `update_memory` - modify existing memory fields
- `delete_memory` - remove by ID, or **bulk-by-tag** with `tags: [...]`
- `check_database_health` - FalkorDB + Qdrant status

### Memory schema

- `importance`: 0.9-1.0 (critical), 0.7-0.8 (important), 0.5-0.6 (standard), <0.5 (minor)
- `confidence`: separate dial - 0.95 user-stated, 0.8 observed pattern, 0.6 tentative inference
- `type`: `Decision` | `Pattern` | `Preference` | `Style` | `Habit` | `Insight` | `Context`
- `tags`: array of bare strings - see convention above

### Content size

- Target 150-300 chars. One paragraph. "Title. Context. Outcome."
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

User preference (importance 0.9, confidence 0.95):
```
store_memory({
  content: "User preference: [exact quote or paraphrase]. Applies when: [context]",
  type: "Preference",
  tags: ["preference", <scope>],
  importance: 0.9,
  confidence: 0.95
})
```

Architectural decision (importance 0.9, confidence 0.9):
```
store_memory({
  content: "Decided [choice] because [rationale]. Alternatives: [X, Y]",
  type: "Decision",
  tags: ["decision", <slug>],
  importance: 0.9,
  confidence: 0.9
})
```

Bug fix (importance 0.75, confidence 0.85):
```
store_memory({
  content: "Fixed [issue] in [project]: [solution]. Root cause: [analysis]",
  type: "Insight",
  tags: ["bugfix", "solution", <slug>],
  importance: 0.75,
  confidence: 0.85
})
```

---

## Mid-conversation memory ops - the three triggers, and only three

**1. User correction or override.**
Listen for: "actually," "no, I prefer," "not X, Y," "that's wrong," "stop doing X," "never do X."
Store as `Preference`, importance 0.9, confidence 0.95, tags include `correction`. Store this turn - not queued for later.

**2. Decision stabilizes after at least one round of discussion.**
Listen for: "let's go with X," "yeah that's the plan," "do it that way," "ship it."
Store as `Decision`, importance 0.85-0.9. If alternatives came up, link with `PREFERS_OVER`.

**3. Pattern articulated - not inferred.**
Listen for: "I always do X," "every time," "this is how I usually," or you observing "you tend to do X" and the user confirming.
Store as `Pattern`, importance 0.8. Link to concrete examples with `EXEMPLIFIES`.

### Relationship types

| Type | Use case |
|---|---|
| `LEADS_TO` | Bug -> Solution, Problem -> Fix |
| `REINFORCES` | Supporting evidence, validation |
| `CONTRADICTS` | Conflicting approaches |
| `EVOLVED_INTO` | Knowledge progression, iterations |
| `INVALIDATED_BY` | Outdated info -> current approach |
| `DERIVED_FROM` | Source relationships, origins |
| `RELATES_TO` | General connections |
| `PREFERS_OVER` | User / team preferences |
| `EXEMPLIFIES` | Pattern examples |
| `OCCURRED_BEFORE` | Temporal sequence |
| `PART_OF` | Hierarchical structure |

---

## Never Store

- Secrets, credentials, API keys, private tokens.
- Temporary build output, logs, debug dumps.
- Large code blocks (store the pattern or decision instead).
- Ephemeral state that changes every session.
- Duplicate memories (recall first).
</memory_rules>
````
