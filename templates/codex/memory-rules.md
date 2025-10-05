<!-- BEGIN AUTOMEM CODEX RULES -->
## Memory-First Development (AutoMem Codex)

Use the AutoMem MCP proactively to maintain persistent context for {{PROJECT_NAME}}.

At the start of a task:

```javascript
mcp_memory_recall_memory({
  query: "<current task or question>",
  tags: ["{{PROJECT_NAME}}"],
  limit: 3
})
```

During the task, store important outcomes:

```javascript
mcp_memory_store_memory({
  content: "Brief title. Context and details. Impact/outcome.",
  type: "Decision",  // or "Pattern", "Insight", "Preference", "Style", "Habit", "Context"
  confidence: 0.95,
  tags: ["{{PROJECT_NAME}}", "<component>", "{{CURRENT_MONTH}}"],
  importance: 0.7
})
```

**Memory Types:**
- **Decision** - Strategic or technical decisions
- **Pattern** - Recurring approaches, best practices
- **Insight** - Key learnings, problem resolutions
- **Preference** - User/team preferences
- **Style** - Code style or formatting
- **Habit** - Regular behaviors or workflows
- **Context** - General information (default)

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

