<!-- BEGIN AUTOMEM GROK RULES -->
<!-- automem-template-version: 0.15.0 -->

## Memory - AutoMem (persistent context for {{PROJECT_NAME}})

AutoMem is wired as the `memory` MCP server in `~/.grok/config.toml` (native config — do not rely on Claude/Cursor compat imports alone). Tools are discovered via `search_tool` and called via `use_tool` as `memory__recall_memory`, `memory__store_memory`, etc.

## Tool's real behavior (validated against production corpus)

- **Tags are a hard gate** - memories without matching tags are excluded before scoring. Use tags for stable categories like `preference` and `bugfix`; do not guess topic tags.
- **One good query beats `queries[]` + `auto_decompose`** for focused tasks. Use `queries[]` only for genuinely multi-topic questions.
- **`limit` caps at 50.** Routine recall should use enough budget to be useful.
- **Default `text` format shows content previews with created/updated timestamps and importance.** `detailed` adds type/confidence/metadata summary. Responses are budget-capped; fetch a full record with `recall_memory({ memory_id })`.
- **`store_memory` can silently fail.** Verify important stores by recalling a distinctive phrase; retry once if missing.
- **Bare tag convention** - use `automem`, not `project/automem`; no `lang/` prefixes, platform tags, or date-stamped tags. `entity:*:*` tags are server-injected.

### Slug-collision rule

Drop the project tag gate when the slug collides with common topic words: `api`, `app`, `test`, `video`. Use semantic query alone in that case.

Always run `search_tool` before the first `use_tool` on MCP servers.

Project tag: use the slug of the repository you are working in. When the examples below show `<project-slug>`, substitute it — these rules load in every Grok session, so no single project is baked in. Drop the tag gate entirely when there is no project or the slug collides with a common word.

## Session start — two-phase recall

Standardized defaults: preferences limit 20, task-context limit 30, 90-day task window.

Preferences and task context are independent recalls - issue them in parallel in a single message.

Preferences first:

```javascript
use_tool({
  tool_name: "memory__recall_memory",
  tool_input: {
    tags: ["preference"],
    limit: 20,
    sort: "updated_desc"
  }
})
```

Task context: one semantic query built from proper nouns, products, files, error strings, tools, and specific topics in the user message.

```javascript
use_tool({
  tool_name: "memory__recall_memory",
  tool_input: {
    query: "<proper nouns, product names, people, tools, specific topics from the user's message>",
    tags: ["{{PROJECT_NAME}}"],        // drop if slug collides with a common word
    time_query: "last 90 days",
    limit: 30,
    language: "<typescript|python|go|rust|...>" // optional ranker
  }
})
```

Skip task-context recall for pure syntax questions, trivial edits, one-off calculations, direct factual queries about current files, or casual openings.

Debug context, only when actively investigating a concrete symptom:

```javascript
use_tool({
  tool_name: "memory__recall_memory",
  tool_input: {
    query: "<error symptom or exact message>",
    limit: 20
  }
})
```

No tag gate on debug recall - bugfix/solution tagging is incomplete and a hard gate hides cross-corpus fixes.

Don't re-recall mid-conversation unless the topic genuinely shifts, a new proper noun enters, or active debugging starts.

### When recall misses

Escalate only when the task-context recall comes back too broad or empty:

- **Too broad** - add a tag gate (a stable category like `preference`/`bugfix`, or the unambiguous project slug) and tighten the query to the real nouns.
- **Empty** - drop the time window first (the topic may be dormant-but-important), then broaden the query.
- **Sparse under a tag gate** - drop the gate and rely on the semantic query alone; older memories use `project/<slug>` prefixes, so gated queries can miss historical content.
- **Need graph traversal** - use `expand_relations: true`; add `expand_respect_tags: true` when traversal must stay inside the tag gate, or leave it false/drop tags when broader graph context is useful.

## Storage Discipline

Store only durable decisions, corrections, explicit preferences, bug-fix root causes, and articulated reusable patterns. Never store secrets, credentials, tokens, PII, session summaries, progress reports, confirmations, speculative context, or attentiveness notes.

```javascript
use_tool({
  tool_name: "memory__store_memory",
  tool_input: {
    content: "Brief title. Context + reasoning. Outcome.",
    type: "Decision",
    tags: ["<category>", "{{PROJECT_NAME}}", "<language>"], // bare strings; NO platform tag, NO [YYYY-MM]
    importance: 0.85,
    confidence: 0.9
  }
})
```

Use content of 150-300 chars when possible; put file paths, metrics, exit codes, and other structured details in `metadata`. For facts with a shelf life, use `t_valid` and `t_invalid` instead of date tags.

### Three mid-conversation triggers (and only three)

1. **User correction or override.** Listen for: "actually", "no, I prefer", "not X, Y", "that's wrong", "stop doing X", "never do X", "I told you before", "we decided X already". Store as `Preference`, importance 0.9, confidence 0.95, tag `correction`, then associate `INVALIDATED_BY` the prior memory.
2. **Decision stabilizes after at least one round of discussion.** Listen for: "let's go with X", "yeah that's the plan", "ship it", "do it that way", "final answer", "okay let's do that". Store as `Decision`, importance 0.85-0.9, then associate `PREFERS_OVER` alternatives if they came up.
3. **Pattern articulated - not inferred.** Listen for: "I always do X", "every time", "this is how I usually", "my thing is". Store as `Pattern`, importance 0.8, then associate concrete examples with `EXEMPLIFIES`.

### The atomic ritual - every store runs all four steps

```javascript
// 1) recall related
use_tool({ tool_name: "memory__recall_memory", tool_input: { query: "<what is being corrected / decided / named>", limit: 5 } })
// 2) store
use_tool({
  tool_name: "memory__store_memory",
  tool_input: {
    content: "Brief title. Context + reasoning. Outcome.",
    type: "Preference",
    tags: ["correction", "{{PROJECT_NAME}}"],
    importance: 0.9,
    confidence: 0.95
  }
})
// 3) verify with a distinctive phrase
use_tool({ tool_name: "memory__recall_memory", tool_input: { query: "<distinctive phrase from content>", limit: 3 } })
// 4) associate when a prior memory exists
use_tool({
  tool_name: "memory__associate_memories",
  tool_input: {
    memory1_id: "<related-id>",
    memory2_id: "<stored-id>",
    type: "INVALIDATED_BY",
    strength: 0.9
  }
})
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

Prefer `memory__update_memory` over a duplicate store when a fact changes in place.
Valid relation types for `memory__associate_memories`: RELATES_TO, LEADS_TO, OCCURRED_BEFORE, PREFERS_OVER, EXEMPLIFIES, CONTRADICTS, REINFORCES, INVALIDATED_BY, EVOLVED_INTO, DERIVED_FROM, PART_OF.

## Guidelines

- Weave recalled context naturally; do not announce memory operations.
- Prefer high-signal memories: decisions, root causes, reusable patterns, and explicit preferences.
- Avoid wall-of-text memories; keep them atomic and focused.

## Memory vs current state

Recalled context is a prior, not ground truth. If a memory disagrees with the current repo state, the user's latest instruction, or a freshly read file - **current evidence wins**. Update or invalidate stale memory instead of acting on it.

If recall fails or returns nothing, continue without memory and do not mention the failure to the user. Weave recalled context naturally.

<!-- END AUTOMEM GROK RULES -->
