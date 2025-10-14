---
description: Intelligently recall relevant memories for the current context
---

# AutoMem Recall

Perform a smart, context-aware recall of stored memories:

1. **Analyze Context**: Examine the current situation:
   - Working directory (extract project name from path)
   - Recently opened files and their purposes
   - User's explicit query or implicit intent

2. **Multi-Strategy Recall**: Execute parallel memory searches using `mcp__memory__recall_memory`:
   
   **Project Context**:
   ```javascript
  mcp__memory__recall_memory({
     query: "project [project-name] architecture decisions features",
     tags: ["[project-name]"],
     limit: 5
   })
   ```
   
   **Recent Work**:
   ```javascript
  mcp__memory__recall_memory({
     tags: ["[project-name]"],
     time_query: "last 7 days",
     limit: 5
   })
   ```
   
   **Specific Intent** (if user provided query):
   ```javascript
  mcp__memory__recall_memory({
     query: "[user's query]",
     tags: ["[project-name]"],
     limit: 5
   })
   ```

3. **Present Results**: Show relevant memories with:
   - Content summary
   - When it was created
   - Importance score
   - Related memories (via associations)
   - Actionable context for current work

4. **Suggest Next Steps**: Based on recalled memories, suggest relevant actions:
   - "Based on the auth refactoring pattern from last week, would you like to apply it here?"
   - "I see you solved a similar bug 3 days ago - want me to recall the solution?"

Make the recall feel natural and conversational, not like a database query.
