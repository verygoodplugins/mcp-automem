<!-- BEGIN AUTOMEM CODEX RULES -->
<!-- automem-codex-version: 0.9.0 -->
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

**Content Size Guidelines:**
- Target: 150-300 characters (one meaningful paragraph)
- Maximum: 500 characters (auto-summarized if exceeded)
- Hard limit: 2000 characters (rejected)
- If more detail needed: split into multiple memories with associations

Guidelines:
- Weave recalled context naturally; avoid meta commentary.
- Prefer high-signal memories (decisions, root causes, reusable patterns).
- Never store secrets or credentials.
- Avoid wall-of-text memories; keep them atomic and focused.

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

### Advanced Recall (for complex questions)

**Multi-hop reasoning** (entity expansion):
```javascript
// "What does Amanda's sister do?" → finds "Amanda's sister is Rachel" → finds Rachel's job
mcp_memory_recall_memory({
  query: "What does Amanda's sister do?",
  expand_entities: true
})
```

**Graph expansion with filtering** (reduce noise):
```javascript
mcp_memory_recall_memory({
  query: "auth architecture",
  expand_relations: true,           // Follow relationships from seed results
  expand_min_importance: 0.5,       // Only include expanded memories with importance >= 0.5
  expand_min_strength: 0.3          // Only follow associations with strength >= 0.3
})
```

**Context-aware coding recall**:
```javascript
mcp_memory_recall_memory({
  query: "error handling patterns",
  language: "python",
  context_types: ["Style", "Pattern"]
})
```

<!-- END AUTOMEM CODEX RULES -->

