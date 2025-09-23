#!/bin/bash

# Capture Code Pattern Hook for AutoMem
# Records significant code changes and patterns

MEMORY_QUEUE="$HOME/.claude/scripts/memory-queue.jsonl"
LOG_FILE="$HOME/.claude/logs/code-patterns.log"

# Ensure directories exist
mkdir -p "$(dirname "$MEMORY_QUEUE")"
mkdir -p "$(dirname "$LOG_FILE")"

# Get edit context from Claude environment
FILE_PATH="${CLAUDE_EDITED_FILE:-}"
EDIT_TYPE="${CLAUDE_EDIT_TYPE:-edit}"
PROJECT_NAME=$(basename "$(pwd)")

# Skip if no file information
[ -z "$FILE_PATH" ] && exit 0

# Get file extension and language
FILE_EXT="${FILE_PATH##*.}"
LANGUAGE="unknown"

case "$FILE_EXT" in
    js|jsx) LANGUAGE="javascript" ;;
    ts|tsx) LANGUAGE="typescript" ;;
    py) LANGUAGE="python" ;;
    php) LANGUAGE="php" ;;
    go) LANGUAGE="go" ;;
    rs) LANGUAGE="rust" ;;
    java) LANGUAGE="java" ;;
    c|h) LANGUAGE="c" ;;
    cpp|hpp|cc) LANGUAGE="cpp" ;;
    sh|bash) LANGUAGE="bash" ;;
    yml|yaml) LANGUAGE="yaml" ;;
    json) LANGUAGE="json" ;;
    md) LANGUAGE="markdown" ;;
esac

# Determine importance based on file type
IMPORTANCE=0.5
MEMORY_TYPE="Pattern"

# Important file patterns
if [[ "$FILE_PATH" =~ (test|spec)\. ]]; then
    IMPORTANCE=0.6
    MEMORY_TYPE="Pattern"
elif [[ "$FILE_PATH" =~ (index|main|app)\. ]]; then
    IMPORTANCE=0.7
    MEMORY_TYPE="Pattern"
elif [[ "$FILE_PATH" =~ config|settings|env ]]; then
    IMPORTANCE=0.8
    MEMORY_TYPE="Context"
elif [[ "$FILE_PATH" =~ (security|auth|crypto) ]]; then
    IMPORTANCE=0.9
    MEMORY_TYPE="Decision"
fi

# Create memory content
CONTENT="Code pattern in $LANGUAGE: edited $(basename "$FILE_PATH") in $PROJECT_NAME"

# Create memory record (only for significant edits)
if (( $(echo "$IMPORTANCE >= 0.6" | bc -l) )); then
    MEMORY_RECORD=$(cat <<EOF
{
  "content": "$CONTENT",
  "tags": ["code-pattern", "$LANGUAGE", "$PROJECT_NAME", "$(date +%Y-%m)"],
  "importance": $IMPORTANCE,
  "type": "$MEMORY_TYPE",
  "metadata": {
    "file_path": "$FILE_PATH",
    "language": "$LANGUAGE",
    "edit_type": "$EDIT_TYPE",
    "project": "$PROJECT_NAME",
    "timestamp": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  }
}
EOF
    )

    # Queue memory for processing
    echo "$MEMORY_RECORD" >> "$MEMORY_QUEUE"
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Code pattern captured: $FILE_PATH" >> "$LOG_FILE"
fi

exit 0