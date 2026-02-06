#!/bin/bash
# Process memory queue - plain npx
trap 'echo "Success"' EXIT

QUEUE_FILE="${HOME}/.claude/scripts/memory-queue.jsonl"

# Check required dependencies
if ! command -v npx >/dev/null 2>&1; then
    echo "Warning: npx not installed - queue processing disabled" >&2
    exit 0
fi

# Skip if queue doesn't exist or is empty
if [ ! -s "$QUEUE_FILE" ]; then
    exit 0
fi

# Process queue
npx -y @verygoodplugins/mcp-automem queue --file "$QUEUE_FILE" --limit 5
