#!/bin/bash

# Capture Error Resolution Hook for AutoMem
# Records error patterns and their solutions

MEMORY_QUEUE="$HOME/.claude/scripts/memory-queue.jsonl"
LOG_FILE="$HOME/.claude/logs/error-resolutions.log"

# Ensure directories exist
mkdir -p "$(dirname "$MEMORY_QUEUE")"
mkdir -p "$(dirname "$LOG_FILE")"

# Get command context
COMMAND="${CLAUDE_LAST_COMMAND:-}"
OUTPUT="${CLAUDE_COMMAND_OUTPUT:-}"
EXIT_CODE="${CLAUDE_EXIT_CODE:-1}"
PROJECT_NAME=$(basename "$(pwd)")

# Only capture if there was an error
[ "$EXIT_CODE" -eq 0 ] && exit 0

# Extract error messages
ERROR_MSG=$(echo "$OUTPUT" | grep -iE "error:|ERROR|exception|fatal|failed" | head -5 | tr '\n' ' ' | sed 's/"/\\"/g')

# Skip if no clear error message
[ -z "$ERROR_MSG" ] && exit 0

# Truncate long error messages
ERROR_MSG="${ERROR_MSG:0:500}"

# Always high importance for errors
IMPORTANCE=0.8
MEMORY_TYPE="Insight"

# Create memory content
CONTENT="Error in $PROJECT_NAME: ${ERROR_MSG:0:200}. Command: $COMMAND"

# Create memory record
MEMORY_RECORD=$(cat <<EOF
{
  "content": "$CONTENT",
  "tags": ["error", "unresolved", "$PROJECT_NAME"],
  "importance": $IMPORTANCE,
  "type": "$MEMORY_TYPE",
  "metadata": {
    "error_message": "$ERROR_MSG",
    "command": "$COMMAND",
    "exit_code": $EXIT_CODE,
    "project": "$PROJECT_NAME",
    "needs_resolution": true
  },
  "timestamp": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
}
EOF
)

# Queue memory for processing
echo "$MEMORY_RECORD" >> "$MEMORY_QUEUE"
echo "[$(date '+%Y-%m-%d %H:%M:%S')] Error captured for resolution: ${ERROR_MSG:0:100}" >> "$LOG_FILE"

# Quick feedback
echo "🧠 Error pattern captured for learning"

exit 0
