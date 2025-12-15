---
description: Store an insight, decision, or pattern to memory
---

# Memory Store

Store important information for future recall:

1. **Identify Memory Type**:
   - **Decision** (0.9): Architecture, library, pattern choices
   - **Insight** (0.8): Bug fixes, root causes, learnings
   - **Pattern** (0.7): Reusable approaches, best practices
   - **Preference** (0.6-0.8): User preferences, style choices
   - **Context** (0.5-0.7): Feature summaries, notes

2. **Format Content**:
   ```
   Brief title. Context and details. Impact/outcome.
   ```

3. **Store with Tags**:
   ```javascript
   mcp__memory__store_memory({
     content: "[formatted content]",
     type: "[Decision|Insight|Pattern|Preference|Context]",
     importance: [0.5-1.0],
     tags: ["project-name", "component", "type", "YYYY-MM"],
     metadata: {
       files_modified: ["relevant/files.ts"],
       // Additional context as needed
     }
   })
   ```

4. **Create Associations** (if related memories exist):
   ```javascript
   mcp__memory__associate_memories({
     memory1_id: "[new-memory-id]",
     memory2_id: "[related-memory-id]",
     type: "RELATES_TO",
     strength: 0.8
   })
   ```

Ask the user what they want to store if not clear from context.
