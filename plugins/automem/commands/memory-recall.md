---
description: Search and recall relevant memories for the current context
---

# Memory Recall

Perform context-aware memory search:

1. **Analyze Context**:
   - Current working directory (extract project name)
   - Recently opened files
   - User's query or intent

2. **Execute Recall**:

   Use `mcp__memory__recall_memory` with appropriate strategy:

   **Project Context** (default):
   ```javascript
   mcp__memory__recall_memory({
     query: "[user query or project context]",
     tags: ["project-name"],
     limit: 10
   })
   ```

   **Recent Work**:
   ```javascript
   mcp__memory__recall_memory({
     tags: ["project-name"],
     time_query: "last 7 days",
     limit: 5
   })
   ```

   **Debug Similar Errors**:
   ```javascript
   mcp__memory__recall_memory({
     query: "[error message keywords]",
     tags: ["bug-fix"],
     limit: 5
   })
   ```

3. **Present Results**: Show memories with:
   - Content summary
   - Creation date
   - Importance score
   - Actionable insights

Present the information naturally, not as a database query result.
