---
description: Process pending memories in the AutoMem queue
---

# AutoMem Queue

Manually process the memory queue (normally happens automatically at session end):

1. **Check Queue**: Look for `~/.claude/scripts/memory-queue.jsonl`:
   - Count entries
   - Show sample of pending memories
   - Display queue size and age

2. **Process Queue**: Execute the queue processor:
   ```bash
   npx @verygoodplugins/mcp-automem queue
   ```

3. **Report Results**:
   - Number of memories processed
   - Number of relationships created
   - Any errors or warnings
   - Confirmation that queue was cleared

4. **Troubleshooting**: If processing fails:
   - Check AutoMem service connectivity
   - Verify queue file is valid JSON Lines format
   - Suggest checking logs at `~/.claude/logs/`
   - Offer to retry with error details

**When to use this command:**
- Testing memory capture during development
- Forcing queue processing without ending session
- Debugging memory storage issues
- Clearing a backed-up queue after service downtime

Display progress and be clear about what's happening at each step.

