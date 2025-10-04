<!-- BEGIN AUTOMEM CODEX RULES -->
## Memory-First Development (AutoMem Codex)

Use the AutoMem MCP proactively to maintain persistent context for {{PROJECT_NAME}}.

At the start of a task:

```javascript
mcp_memory_recall_memory({
  query: "<current task or question>",
  tags: ["{{PROJECT_NAME}}", "codex"],
  limit: 3
})
```

During the task, store important outcomes:

```javascript
mcp_memory_store_memory({
  content: "[TYPE] Brief title. Context and details. Impact/outcome.",
  tags: ["{{PROJECT_NAME}}", "codex", "<component>", "{{CURRENT_MONTH}}"],
  importance: 0.7
})
```

Types: decision, bug-fix, pattern, feature, config, refactor

Guidelines:
- Weave recalled context naturally; avoid meta commentary.
- Prefer high-signal memories (decisions, root causes, reusable patterns).
- Never store secrets or credentials.

Optional: Link related memories for richer context:

```javascript
mcp_memory_associate_memories({
  memory1_id: "<id1>",
  memory2_id: "<id2>",
  type: "RELATES_TO",
  strength: 0.8
})
```

Tagging:
1) {{PROJECT_NAME}}  2) codex  3) component  4) {{CURRENT_MONTH}}

<!-- END AUTOMEM CODEX RULES -->

