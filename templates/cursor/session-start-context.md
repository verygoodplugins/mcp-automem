<!-- automem-template-version: 0.17.1 --> <!-- x-release-please-version -->

AutoMem session context for {{PROJECT_NAME}}.
Perform the initial preference and task-context recalls once per conversation, when the first user request is available. If the project rule already prompted these recalls, do not repeat them. Use the tool names actually exposed by Cursor for the configured AutoMem server.
The always-on AutoMem project rule supplies storage and association guidance. Hooks never store memories. If tools or the service are unavailable, continue the task normally.

## Session start — two-phase recall

Standardized defaults: preferences limit 20, task-context limit 30, 90-day task window.

Preferences and task context are independent recalls - issue them in parallel in a single message.

Preferences first:

```javascript
{{MCP_TOOL_PREFIX}}recall_memory({
  tags: ["preference"],
  limit: 20,
  sort: "updated_desc"
})
```

Task context: one semantic query built from proper nouns, products, files, error strings, tools, and specific topics in the user message.

```javascript
{{MCP_TOOL_PREFIX}}recall_memory({
  query: "<proper nouns, product names, people, tools, specific topics from the user's message>",
  tags: ["{{PROJECT_NAME}}"],        // drop if slug collides with a common word
  time_query: "last 90 days",
  limit: 30,
  language: "<typescript|python|...>", // optional ranker - boosts, does not gate
  active_path: "<current file path>"   // optional Cursor ranker
})
```

Skip task-context recall for pure syntax questions, trivial edits, one-off calculations, direct factual queries about current files, or casual openings.

Debug context, only when actively investigating a concrete symptom:

```javascript
{{MCP_TOOL_PREFIX}}recall_memory({
  query: "<error symptom or exact message>",
  limit: 20
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
