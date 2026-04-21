---
description: Search and recall relevant memories for the current context
---

# Memory Recall

Perform context-aware memory search:

1. **Analyze Context**:
   - User's actual nouns: project names, products, files, errors, people, tools
   - Whether this is a preferences recall, project-context recall, or debugging recall
   - Whether a tag gate would help or would hard-filter away relevant results

2. **Execute Recall**:

   Use `mcp__memory__recall_memory` with appropriate strategy:

   **Preferences**:
   ```javascript
   mcp__memory__recall_memory({
     tags: ["preference"],
     limit: 20,
     sort: "updated_desc",
     format: "detailed"
   })
   ```

   **Project / task context**:
   ```javascript
   mcp__memory__recall_memory({
     query: "[proper nouns, file names, tool names, specific topics from the user's request]",
     tags: ["project-slug"],   // drop if ambiguous
     time_query: "last 90 days",
     limit: 30,
     format: "detailed"
   })
   ```

   **Debug Similar Errors**:
   ```javascript
   mcp__memory__recall_memory({
     query: "[error message keywords]",
     tags: ["bugfix", "solution"],
     limit: 20
   })
   ```

   Use `queries[]` only for genuinely multi-topic questions. Prefer one good query over templated multi-query recall.

3. **Present Results**: Show memories with:
   - Content summary
   - Creation date
   - Importance score
   - Actionable insights

Present the information naturally, not as a database query result.
