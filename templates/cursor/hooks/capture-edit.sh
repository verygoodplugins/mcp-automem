#!/bin/bash

# Cursor File Edit Capture Hook
# Triggered on afterFileEdit - queues code changes for memory processing
# Input: JSON via stdin with { "file_path": "...", "edits": [...] }
# Output: None (afterFileEdit hooks don't return data)

# Configuration
QUEUE_FILE="$HOME/.cursor/memory-queue.jsonl"
FILTERS_FILE="$HOME/.cursor/scripts/memory-filters.json"
LOG_FILE="$HOME/.cursor/logs/hooks.log"

# Ensure directories exist
mkdir -p "$(dirname "$QUEUE_FILE")" "$(dirname "$LOG_FILE")"

# Log function
log_message() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] [capture-edit] $1" >> "$LOG_FILE"
}

log_message "File edit capture hook triggered"

# Read JSON input from stdin
INPUT=$(cat)

# Parse input
FILE_PATH=$(echo "$INPUT" | jq -r '.file_path // ""' 2>/dev/null || echo "")
CONVERSATION_ID=$(echo "$INPUT" | jq -r '.conversation_id // ""' 2>/dev/null || echo "")

if [ -z "$FILE_PATH" ]; then
    log_message "No file path provided, skipping"
    exit 0
fi

log_message "Processing edit: $FILE_PATH"

# Get project context
CURRENT_DIR=$(pwd)
PROJECT_NAME=$(basename "$CURRENT_DIR")

if [ -f "package.json" ]; then
    PKG_NAME=$(jq -r '.name // ""' package.json 2>/dev/null | sed 's/@.*\///')
    if [ -n "$PKG_NAME" ]; then
        PROJECT_NAME="$PKG_NAME"
    fi
fi

# Get git context
GIT_BRANCH=""
if git rev-parse --git-dir > /dev/null 2>&1; then
    GIT_BRANCH=$(git branch --show-current 2>/dev/null || echo "")
fi

# Get relative file path
RELATIVE_PATH=$(realpath --relative-to="$CURRENT_DIR" "$FILE_PATH" 2>/dev/null || basename "$FILE_PATH")

# Check if file should be filtered out
SHOULD_SKIP=false

if [ -f "$FILTERS_FILE" ]; then
    # Check trivial patterns
    FILE_BASENAME=$(basename "$FILE_PATH")
    FILE_EXT="${FILE_BASENAME##*.}"
    
    # Common trivial file patterns
    case "$FILE_BASENAME" in
        package-lock.json|yarn.lock|pnpm-lock.yaml|Gemfile.lock|composer.lock|.DS_Store)
            SHOULD_SKIP=true
            log_message "Skipping trivial file: $FILE_BASENAME"
            ;;
    esac
    
    # Check if in node_modules, dist, build, etc.
    if [[ "$FILE_PATH" =~ (node_modules|dist|build|\.next|\.nuxt|vendor|target)/.*$ ]]; then
        SHOULD_SKIP=true
        log_message "Skipping generated/dependency file: $RELATIVE_PATH"
    fi
fi

if [ "$SHOULD_SKIP" = true ]; then
    exit 0
fi

# Get edit summary
EDITS=$(echo "$INPUT" | jq -c '.edits // []' 2>/dev/null || echo "[]")
EDIT_COUNT=$(echo "$EDITS" | jq 'length' 2>/dev/null || echo "0")

log_message "Processing $EDIT_COUNT edits to $RELATIVE_PATH"

# Queue the edit for processing
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

python3 <<EOF >> "$QUEUE_FILE" 2>/dev/null || true
import json
import sys

edits_raw = '''$EDITS'''
edits = json.loads(edits_raw) if edits_raw else []

# Calculate significance
edit_count = len(edits)
total_chars_changed = sum(len(e.get('old_string', '')) + len(e.get('new_string', '')) for e in edits)

# Determine importance
importance = 0.5
if edit_count > 10 or total_chars_changed > 500:
    importance = 0.7
if edit_count > 20 or total_chars_changed > 1000:
    importance = 0.8

# Create memory entry
memory_entry = {
    "content": f"Edited {edit_count} section(s) in $RELATIVE_PATH",
    "tags": ["$PROJECT_NAME", "cursor", "code-edit", "$FILE_EXT"],
    "importance": importance,
    "type": "code_edit",
    "timestamp": "$TIMESTAMP",
    "metadata": {
        "file_path": "$RELATIVE_PATH",
        "edit_count": edit_count,
        "chars_changed": total_chars_changed,
        "git_branch": "$GIT_BRANCH",
        "conversation_id": "$CONVERSATION_ID"
    }
}

print(json.dumps(memory_entry))
EOF

log_message "Edit queued for $RELATIVE_PATH"

exit 0

