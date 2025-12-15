---
description: Check AutoMem service health and connection status
---

# Memory Health Check

Verify the AutoMem memory service is working:

1. **Check Service Health**:
   ```javascript
   mcp__memory__check_database_health()
   ```

2. **Report Status**:
   - Overall health status (healthy/error)
   - FalkorDB graph database status
   - Qdrant vector database status
   - Any error messages

3. **Troubleshooting** (if unhealthy):
   - Verify `AUTOMEM_ENDPOINT` environment variable is set
   - Check if AutoMem service is running
   - Confirm network connectivity

Present the health status clearly with any issues highlighted.
