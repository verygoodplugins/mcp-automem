---
description: Check AutoMem system status and recent memory activity
---

# AutoMem Status

Check the health and status of the AutoMem memory system:

1. **System Health**: Use `mcp__memory__check_database_health` to verify:
   - Database connectivity (FalkorDB graph database)
   - Vector store status (Qdrant)
   - Service availability

2. **Recent Activity**: Query memories from today using `mcp__memory__recall_memory`:
   - Count of memories stored today
   - Recent memory types (decisions, patterns, bug fixes)
   - Active tags and components

3. **Queue Status**: Check if there's a pending memory queue at `~/.claude/scripts/memory-queue.jsonl`:
   - Number of pending memories
   - Queue file size
   - Last queue processing time

4. **Display Format**: Present the status in a clean, easy-to-read format:
   ```
   🧠 AutoMem Status
   ==================
   
   System Health: ✓ Connected
   - Graph DB: FalkorDB (healthy)
   - Vector Store: Qdrant (healthy)
   
   Today's Activity:
   - Memories stored: 12
   - Decisions: 3
   - Patterns: 2
   - Bug fixes: 4
   
   Queue: 0 pending
   ```

Be helpful and suggest actions if there are issues (e.g., "Service unreachable - check if AutoMem is running at localhost:5050").
