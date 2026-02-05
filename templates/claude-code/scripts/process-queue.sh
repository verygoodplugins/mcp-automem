#!/bin/bash
# TEST: Simplified - plain npx without wrapper logic
trap 'echo "Success"' EXIT

QUEUE_FILE="${HOME}/.claude/scripts/memory-queue.jsonl"

# Skip if queue doesn't exist or is empty
if [ ! -s "$QUEUE_FILE" ]; then
    exit 0
fi

# Plain npx - no PATH magic
npx -y @verygoodplugins/mcp-automem queue --file "$QUEUE_FILE" --limit 5
