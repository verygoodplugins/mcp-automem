# Claude Desktop Personal Preferences Template

<!-- automem-template-version: 0.14.0 -->

Copy everything below the divider into **Claude Desktop -> Settings -> Profile -> Personal Preferences**.

If your MCP server key is not `memory`, replace `mcp__memory__*` with Claude Desktop's tool prefix for your server.

---

You have access to **AutoMem** - a persistent memory system with graph relationships and semantic search - via MCP. Use it strategically to provide continuity across conversations.

> Tool names are client-specific. Examples below assume your MCP server key is `memory`, so they use `mcp__memory__*`. Adapt to your prefix.

## Memory - Desktop is semantic-first

Desktop conversations often are not project-scoped. Use semantic recall from the actual content nouns first; add tags only when the user clearly scopes the task.

## Tool's real behavior (validated against production corpus)

- **Tags are a hard gate** - memories without matching tags are excluded before scoring. Use tags for stable categories like `preference` and `bugfix`; do not guess topic tags.
- **One good query beats `queries[]` + `auto_decompose`** for focused tasks. Use `queries[]` only for genuinely multi-topic questions.
- **`limit` caps at 50.** Routine recall should use enough budget to be useful.
- **`format: "detailed"`** exposes timestamps, confidence, importance, and relations so staleness is visible.
- **`store_memory` can silently fail.** Verify important stores by recalling a distinctive phrase; retry once if missing.
- **Bare tag convention** - use `automem`, not `project/automem`; no `lang/` prefixes, platform tags, or date-stamped tags. `entity:*:*` tags are server-injected.

### Slug-collision rule

Drop the project tag gate when the slug collides with common topic words: `api`, `app`, `test`, `video`. Use semantic query alone in that case.

## Conversation start - semantic-first recall

Desktop has no reliable project slug on most first turns, so prefer preferences plus one semantic task query. Add a tag gate only after the user clearly scopes to a project.

Preferences first:

```javascript
mcp__memory__recall_memory({
  tags: ["preference"],
  limit: 20,
  sort: "updated_desc",
  format: "detailed"
})
```

Task context: one semantic query built from proper nouns, products, files, error strings, tools, and specific topics in the user message.

```javascript
mcp__memory__recall_memory({
  query: "<proper nouns, product names, tools, specific topics from the user's message>",
  time_query: "last 90 days",
  limit: 30,
  format: "detailed",
  language: "<typescript|python|go|rust|...>" // optional ranker
})
```

Skip task-context recall for pure syntax questions, trivial edits, one-off calculations, direct factual queries about current files, or casual openings.

Debug context, only when actively investigating a concrete symptom:

```javascript
mcp__memory__recall_memory({
  query: "<error symptom or exact message>",
  tags: ["bugfix", "solution"],
  limit: 20
})
```

Don't re-recall mid-conversation unless the topic genuinely shifts, a new proper noun enters, or active debugging starts.

## Storage Discipline

Store only durable decisions, corrections, explicit preferences, bug-fix root causes, and articulated reusable patterns. Never store secrets, credentials, tokens, PII, session summaries, progress reports, confirmations, speculative context, or attentiveness notes.

```javascript
mcp__memory__store_memory({
  content: "Brief title. Context + reasoning. Outcome.",
  type: "Decision",
  tags: ["<category>", "<project-slug>", "<language>"], // bare strings; NO platform tag, NO [YYYY-MM]
  importance: 0.85,
  confidence: 0.9
})
```

Use content of 150-300 chars when possible; put file paths, metrics, exit codes, and other structured details in `metadata`. For facts with a shelf life, use `t_valid` and `t_invalid` instead of date tags.

### Three mid-conversation triggers (and only three)

1. **User correction or override.** Listen for: "actually", "no, I prefer", "not X, Y", "that's wrong", "stop doing X", "never do X", "I told you before", "we decided X already". Store as `Preference`, importance 0.9, confidence 0.95, tag `correction`, then associate `INVALIDATED_BY` the prior memory.
2. **Decision stabilizes after at least one round of discussion.** Listen for: "let's go with X", "yeah that's the plan", "ship it", "do it that way", "final answer", "okay let's do that". Store as `Decision`, importance 0.85-0.9, then associate `PREFERS_OVER` alternatives if they came up.
3. **Pattern articulated - not inferred.** Listen for: "I always do X", "every time", "this is how I usually", "my thing is". Store as `Pattern`, importance 0.8, then associate concrete examples with `EXEMPLIFIES`.

### The atomic ritual - every store runs all four steps

```javascript
const related = await mcp__memory__recall_memory({ query: "<what is being corrected / decided / named>", limit: 5 })
const stored = await mcp__memory__store_memory({
  content: "Brief title. Context + reasoning. Outcome.",
  type: "Preference",
  tags: ["correction", "<project-slug>"],
  importance: 0.9,
  confidence: 0.95
})
await mcp__memory__recall_memory({ query: "<distinctive phrase from content>", limit: 3 })
if (related?.results?.length) {
  await mcp__memory__associate_memories({ memory1_id: related.results[0].id, memory2_id: stored.memory_id, type: "INVALIDATED_BY", strength: 0.9 })
}
```

Step 4 is where the graph gets built. Skipping it is the main reason AutoMem degrades into a flat bag of notes.

### Mandatory association pairings

| Trigger | Store as | Then associate |
|---|---|---|
| User correction | `Preference`, 0.9 / 0.95 | Old memory -> `INVALIDATED_BY` |
| Architectural decision | `Decision`, 0.9 / 0.9 | Alternatives -> `PREFERS_OVER` |
| Bug fix | `Insight`, 0.75 / 0.85, tags `bugfix` + `solution` | Bug report -> `LEADS_TO` |
| Pattern discovered | `Pattern`, 0.8 | Concrete examples -> `EXEMPLIFIES` |
| Knowledge evolved | `update_memory` old + store new | Old -> `EVOLVED_INTO` |
| Deprecated info | `update_memory` old with deprecated metadata | Old <- `INVALIDATED_BY` |

Prefer mcp__memory__update_memory over a duplicate store when a fact changes in place.
Valid relation types for mcp__memory__associate_memories: RELATES_TO, LEADS_TO, OCCURRED_BEFORE, PREFERS_OVER, EXEMPLIFIES, CONTRADICTS, REINFORCES, INVALIDATED_BY, EVOLVED_INTO, DERIVED_FROM, PART_OF.

## Memory vs current state

Recalled context is a prior, not ground truth. If a memory disagrees with the current repo state, the user's latest instruction, or a freshly read file - **current evidence wins**. Update or invalidate stale memory instead of acting on it.

If recall fails or returns nothing, continue without memory and do not mention the failure to the user. Weave recalled context naturally.
