#!/bin/bash

# Capture Search Result Hook for AutoMem
# Records useful search queries and results

MEMORY_QUEUE="$HOME/.claude/scripts/memory-queue.jsonl"
LOG_FILE="$HOME/.claude/logs/search-results.log"

# Ensure directories exist
mkdir -p "$(dirname "$MEMORY_QUEUE")"
mkdir -p "$(dirname "$LOG_FILE")"

# Get search context from Claude environment
SEARCH_QUERY="${CLAUDE_SEARCH_QUERY:-}"
SEARCH_RESULTS="${CLAUDE_SEARCH_RESULTS:-}"
PROJECT_NAME=$(basename "$(pwd)")

# Skip if no search query
[ -z "$SEARCH_QUERY" ] && exit 0

# Determine search topic
SEARCH_TOPIC="general"
if echo "$SEARCH_QUERY" | grep -qiE "error|bug|issue|problem|fix"; then
    SEARCH_TOPIC="troubleshooting"
    IMPORTANCE=0.7
elif echo "$SEARCH_QUERY" | grep -qiE "how to|tutorial|guide|example"; then
    SEARCH_TOPIC="learning"
    IMPORTANCE=0.6
elif echo "$SEARCH_QUERY" | grep -qiE "best practice|pattern|architecture|design"; then
    SEARCH_TOPIC="patterns"
    IMPORTANCE=0.8
elif echo "$SEARCH_QUERY" | grep -qiE "security|vulnerability|exploit|cve"; then
    SEARCH_TOPIC="security"
    IMPORTANCE=0.9
else
    IMPORTANCE=0.5
fi

MEMORY_TYPE="Context"

# Create memory content
CONTENT="Search: $SEARCH_QUERY (topic: $SEARCH_TOPIC) in context of $PROJECT_NAME"

# Only store if importance is high enough
if (( $(echo "$IMPORTANCE >= 0.6" | bc -l) )); then
    # Create memory record
    MEMORY_RECORD=$(cat <<EOF
{
  "content": "$CONTENT",
  "tags": ["search", "$SEARCH_TOPIC", "$PROJECT_NAME", "$(date +%Y-%m)"],
  "importance": $IMPORTANCE,
  "type": "$MEMORY_TYPE",
  "metadata": {
    "query": "$SEARCH_QUERY",
    "topic": "$SEARCH_TOPIC",
    "project": "$PROJECT_NAME",
    "timestamp": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  }
}
EOF
    )

    # Queue memory for processing
    echo "$MEMORY_RECORD" >> "$MEMORY_QUEUE"
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Search query captured: $SEARCH_QUERY" >> "$LOG_FILE"
fi

exit 0