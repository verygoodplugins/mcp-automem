---
description: Store an insight, decision, or pattern to memory
---

# Memory Store

Store important information for future recall:

Bug fixes: Insight, importance 0.75, confidence 0.85. Articulated patterns: Pattern, importance 0.8. User corrections: Preference, importance 0.9, confidence 0.95.

1. **Identify Memory Type**:
   - **Decision** (0.9): Architecture, library, pattern choices
   - **Insight** (0.75): Bug fixes, root causes, learnings
   - **Pattern** (0.8): Reusable approaches, best practices
   - **Preference** (0.9 for corrections): User preferences, style choices
   - **Context** (0.5-0.7): Feature summaries, notes

2. **Format Content**:
   ```text
   Brief title. Context and details. Impact/outcome.
   ```

3. **Store with Tags**:
   ```javascript
   store_memory({
     content: "[formatted content]",
     type: "[Decision|Insight|Pattern|Preference|Context]",
     importance: [0.5-1.0],
     confidence: [0.6-0.95],
     tags: ["category", "project-slug", "language"],
     metadata: {
       files_modified: ["relevant/files.ts"],
       // Additional context as needed
     }
   })
   ```

   Use bare tags only. No namespace prefixes (`project/*`, `lang/*`), no platform tags, and no date-stamped tags. Keep source attribution in metadata and dates in timestamp / t_valid / t_invalid.

4. **Create Associations** (if related memories exist):
   ```javascript
   associate_memories({
     memory1_id: "[related-memory-id]",
     memory2_id: "[new-memory-id]",
     type: "[INVALIDATED_BY|PREFERS_OVER|EXEMPLIFIES|LEADS_TO]",
     strength: 0.8
   })
   ```

Recall first when the new memory updates or supersedes existing knowledge. Prefer `update_memory` over near-duplicate stores for facts that changed in place.

Ask the user what they want to store if not clear from context.
