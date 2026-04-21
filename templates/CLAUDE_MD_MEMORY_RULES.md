# AutoMem Memory Rules for CLAUDE.md

<!-- automem-template-version: 0.13.0 -->

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

---

## Tool's real behavior (validated against production corpus)

- **Tags are a hard gate** — memories without a matching tag are excluded before scoring. Useful when you genuinely want a category (`preference`, `bugfix`); harmful when you're guessing a project slug.
- **`auto_decompose: true` with template queries hurts focused recalls.** Sub-queries converge on the same top scorers, dedup strips them, residuals don't clear threshold. Keep it off by default; turn it on only for genuinely multi-topic questions.
- **`limit` caps at 50.** Anything under 15 is throwing away context budget you have.
- **`format: "detailed"`** gives timestamps, confidence, importance, and relations inline. Default `text` hides all of it. Use detailed when you need to judge staleness.
- **`expand_relations: true` breaks under tag gates** — server re-applies the filter to expansion targets. If you want graph traversal, drop the tag.
- **`store_memory` can silently fail** (returns success, doesn't persist). After storing anything you care about, recall it back with a distinctive phrase to verify. Retry if gone.
- **Bare tag convention** — `automem`, not `project/automem`. Older memories use `project/<slug>` prefixes, so tag-gated queries on slugs can miss historical content. When a gate returns sparse, retry without it. `entity:people:*`-style tags are server-injected — don't author them.

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
| Discovery / debugging / pre-edit lookup | Semantic `query` only. Do NOT gate on topical tags. |

Do not rely on `context_tags` as a boost right now. Known server quirks: literal string match with no prefix-index consultation, and small `limit` values can drop boosted results before ranking. Use generous `limit` + good semantic `query` instead.

---

## Session Start — Two-Phase Recall (1M-context params)

Run these at session start (the `automem-session-start.sh` hook prompts you; actually execute the calls). Opus 4.7's 1M context lets us use higher limits and a wider time window than the old defaults.

**Phase 1 — Preferences** (tag-only, no time filter, no query):
```
mcp__memory__recall_memory({
  tags: ["preference"],
  limit: 20,
  sort: "updated_desc",
  format: "detailed"
})
```

No query, no time gate. Sort by `updated_desc` so the freshest preferences win; `format: "detailed"` surfaces timestamps/confidence/importance inline so you can judge staleness at a glance.

**Phase 2 — Task context** (single semantic query built from content nouns + project-slug gate + 90-day window):
```
mcp__memory__recall_memory({
  query: "<proper nouns, specific tools, exact topics from the user's message>",
  tags: [<project-slug>],
  time_query: "last 90 days",
  limit: 30,
  format: "detailed"
})
```

How to write the query:
- Use the specific things named. "AutoMem Discord bot Railway deploy" beats "current project status."
- Proper nouns are gold — people, products, places.
- Tools mentioned = include them (Railway, Vercel, pytest, etc.).
- Skip meta words. "Recent," "decisions," "corrections" water down the embedding.
- Code context: add `language: "typescript"` / `"python"` as a _ranker_ (boosts in-language memories, doesn't gate them).

Gate by the working-directory-derived project slug when it's unambiguous (see slug-collision rule); drop the gate otherwise. **Use `queries[]` + `auto_decompose: true` only for genuinely multi-topic questions** — the empirical default is one good query.

**Phase 3 — On-demand debugging** (only when actively investigating a specific error symptom):
```
mcp__memory__recall_memory({
  query: "<error message or symptom>",
  tags: ["bugfix", "solution"],
  limit: 20
})
```

Don't re-recall mid-conversation unless the topic genuinely shifts. With 1M context, memories pulled on turn 1 are still in scope — burning another recall on turn 4 of the same thread is waste.

**Validated tradeoffs** (tested on production corpus of ~9,400 memories):
- `limit 10→30` and `time_query "last 30 days"→"last 90 days"` compound: 2.5× useful results with zero score-quality loss.
- Single-query Phase 2 consistently beats `queries[]` + `auto_decompose` on focused tasks.
- `expand_relations`: no-op on the current sparse-association corpus. Revisit after association authoring discipline is established.

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
- `confidence`: separate dial — 0.95 user-stated, 0.8 observed pattern, 0.6 tentative inference. Don't default everything to 0.95; it flattens the signal decay uses to identify noise.
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

Feature implementation (importance 0.8, confidence 0.8):
```
store_memory({
  content: "Implemented [feature] using [approach]",
  type: "Pattern",
  tags: ["pattern", "feature", <slug>],
  importance: 0.8,
  confidence: 0.8
})
```

---

## Mid-conversation memory ops — the three triggers, and only three

Most memory systems fail here. Guidance that only lists what _counts_ as a correction or a decision, without telling you how to notice one fired mid-turn, results in stores piling up at session end (the session-summary dump pattern) or not happening at all. The fix is to listen for specific trigger phrases and treat store-and-associate as a single atomic ritual, not two separate thoughts.

**1. User correction or override.**
Listen for: "actually," "no, I prefer," "not X, Y," "that's wrong," "stop doing X," "never do X," "I told you before," "we decided X already," "you keep doing Y."
Store as `Preference`, importance 0.9, confidence 0.95, tags include `correction`. Store this turn — not queued for later.

**2. Decision stabilizes after at least one round of discussion.**
Listen for: "let's go with X," "yeah that's the plan," "do it that way," "ship it," "final answer," "okay let's do that." Signal: the decision survived a round of pushback. One-turn ideas don't qualify — they haven't stabilized.
Store as `Decision`, importance 0.85–0.9. If alternatives came up, link with `PREFERS_OVER`.

**3. Pattern articulated — not inferred.**
Listen for: "I always do X," "every time," "this is how I usually," "my thing is," or you observing "you tend to do X" and the user confirming. Patterns get stored when they're _articulated_, not when you pattern-match silently.
Store as `Pattern`, importance 0.8. Link to concrete examples with `EXEMPLIFIES`.

### The atomic ritual — every store runs all four steps

When a trigger fires, run this sequence inline in the same turn:

```
// Step 1: Recall to find what this relates to
const related = recall_memory({
  query: "<what's being corrected / decided / named>",
  limit: 5
})

// Step 2: Store with type, importance, tags, non-default confidence
const newId = store_memory({
  content: "Brief title. Context + reasoning. Outcome.",
  type: "Preference",  // or Decision / Pattern
  tags: ["correction", <scope if any>],
  importance: 0.9,
  confidence: 0.95
})

// Step 3: Verify the store landed (silent-fail insurance)
recall_memory({ query: "<distinctive phrase from content>", limit: 3 })
// If not in results, retry the store once.

// Step 4: Link to step 1's result if plausible
if (related?.results?.length) {
  associate_memories({
    memory1_id: related.results[0].id,
    memory2_id: newId,
    type: "INVALIDATED_BY",  // or PREFERS_OVER / EXEMPLIFIES
    strength: 0.9
  })
}
```

Step 4 is where the graph actually gets built. Skipping it is the #1 reason AutoMem degrades into a flat bag of notes.

### Prefer `update_memory` over new-store-plus-invalidate

When a fact changes — a price, a URL, a version, a name, a deployment state — update the existing memory in place. Use store + `INVALIDATED_BY` only when the old memory represents a genuinely different decision worth preserving for the record ("we considered $15/mo before landing on $9/mo" is archaeology; "the dev URL changed" is not).

```
update_memory({
  memory_id: <existing id>,
  content: <updated content>,
  importance: 0.85  // optional — adjust if stakes changed
})
```

### Mandatory association pairings

| Trigger | Store | Then associate |
|---|---|---|
| User correction | `type: Preference`, importance 0.9 | Search old memory → `INVALIDATED_BY` (strength 0.9) |
| Architectural decision | `type: Decision`, importance 0.9 | Find alternatives → `PREFERS_OVER` |
| Bug fix | `type: Insight`, importance 0.75 | Link to bug report → `LEADS_TO` |
| Pattern discovered | `type: Pattern`, importance 0.8 | Link to abstract concept → `EXEMPLIFIES` |
| Knowledge evolved | `update_memory` old + store new | `EVOLVED_INTO` (old → new) |
| Deprecated info | `update_memory` (importance 0.1, `metadata.deprecated: true`) | `INVALIDATED_BY` (old ← new) |

Skip the association only if the related-memory search returns nothing plausible.

### What NOT to store mid-conversation

- **Session summaries.** Ever. "End of session, here's what we accomplished" is the pattern that creates most corpus garbage.
- **Agent task result dumps.** Same family.
- **"Useful context that might matter later."** Speculative stores are noise. If unsure, skip.
- **Things the user said they'll remember themselves** — calendar, plans, preferences about restaurants. That's journaling, not memory infrastructure.
- **Confirmations.** "Great, that worked" doesn't need a memory. The decision that preceded it might.
- **Anything stored to perform attentiveness.** Memory is for future-you, not for showing the user you were listening this turn.

### Mid-conversation recall is rarer than you'd think

With 1M context, turn-1 memories are still loaded on turn 15. Mid-conversation recall is only justified when:
1. **Topic genuinely shifts.** New topic → new recall.
2. **About to assert a specific technical claim and want to verify it's current.**
3. **A proper noun you don't recognize enters the conversation.** Quick targeted recall on just that noun.

Not justified: re-pulling general preferences, "checking if there's anything else relevant," pre-emptive context gathering just in case.

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
