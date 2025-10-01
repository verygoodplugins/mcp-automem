#!/bin/bash

# Cursor Session Initialization Hook
# Triggered on beforeSubmitPrompt - initializes session queue and recalls relevant memories
# Input: JSON via stdin with { "prompt": "...", "attachments": [...] }
# Output: JSON with { "continue": true, "agentMessage": "..." }

# Configuration
QUEUE_FILE="$HOME/.cursor/memory-queue.jsonl"
LOG_FILE="$HOME/.cursor/logs/hooks.log"

# Ensure directories exist
mkdir -p "$(dirname "$QUEUE_FILE")" "$(dirname "$LOG_FILE")"

# Log function
log_message() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] [init-session] $1" >> "$LOG_FILE"
}

log_message "Session initialization hook triggered"

# Read JSON input from stdin
INPUT=$(cat)

# Parse input
PROMPT=$(echo "$INPUT" | jq -r '.prompt // ""' 2>/dev/null || echo "")
CONVERSATION_ID=$(echo "$INPUT" | jq -r '.conversation_id // ""' 2>/dev/null || echo "")

# Detect project context
CURRENT_DIR=$(pwd)
PROJECT_NAME=$(basename "$CURRENT_DIR")

# Try to get project name from package.json
if [ -f "package.json" ]; then
    PKG_NAME=$(jq -r '.name // ""' package.json 2>/dev/null | sed 's/@.*\///')
    if [ -n "$PKG_NAME" ]; then
        PROJECT_NAME="$PKG_NAME"
    fi
fi

# Get git context if available
GIT_BRANCH=""
GIT_REPO=""
if git rev-parse --git-dir > /dev/null 2>&1; then
    GIT_BRANCH=$(git branch --show-current 2>/dev/null || echo "")
    GIT_REPO=$(git remote get-url origin 2>/dev/null | sed 's/.*[:/]\([^/]*\/[^/]*\)\.git$/\1/' || echo "")
fi

log_message "Project: $PROJECT_NAME, Branch: $GIT_BRANCH"

# Create session marker
SESSION_ID="${CONVERSATION_ID:-$(date +%s)}"
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

# Queue session start marker
SESSION_MARKER=$(python3 <<EOF
import json
session_marker = {
    "type": "session_start",
    "session_id": "$SESSION_ID",
    "project": "$PROJECT_NAME",
    "git_branch": "$GIT_BRANCH",
    "git_repo": "$GIT_REPO",
    "timestamp": "$TIMESTAMP",
    "prompt_preview": """$PROMPT"""[:200]
}
print(json.dumps(session_marker))
EOF
)

echo "$SESSION_MARKER" >> "$QUEUE_FILE" 2>/dev/null || true

log_message "Session marker queued: $SESSION_ID"
log_message "Memory content: $SESSION_MARKER"

# Export AUTOMEM env vars from Cursor's MCP config if available
if [ -f "$HOME/.cursor/mcp.json" ]; then
    AUTOMEM_ENDPOINT=$(jq -r '.mcpServers.memory.env.AUTOMEM_ENDPOINT // empty' "$HOME/.cursor/mcp.json" 2>/dev/null)
    AUTOMEM_API_KEY=$(jq -r '.mcpServers.memory.env.AUTOMEM_API_KEY // empty' "$HOME/.cursor/mcp.json" 2>/dev/null)
    
    if [ -n "$AUTOMEM_ENDPOINT" ]; then
        export AUTOMEM_ENDPOINT
        log_message "Using AUTOMEM_ENDPOINT from mcp.json: $AUTOMEM_ENDPOINT"
    fi
    
    if [ -n "$AUTOMEM_API_KEY" ]; then
        export AUTOMEM_API_KEY
        log_message "Using AUTOMEM_API_KEY from mcp.json"
    fi
fi

# Attempt to recall relevant memories (non-blocking, best effort)
MEMORY_CONTEXT=""
if [ -n "$PROMPT" ] && [ ${#PROMPT} -gt 10 ]; then
    log_message "Attempting memory recall for prompt preview"
    
    # Use npx with timeout to avoid blocking
    RECALL_OUTPUT=$(timeout 2s npx -y @verygoodplugins/mcp-automem recall \
        --query "${PROMPT:0:200}" \
        --tags "$PROJECT_NAME" "cursor" \
        --limit 3 2>/dev/null || echo "")
    
    if [ -n "$RECALL_OUTPUT" ] && [ "$RECALL_OUTPUT" != "[]" ]; then
        # Parse and format memories
        MEMORY_CONTEXT=$(echo "$RECALL_OUTPUT" | python3 -c "
import sys, json
try:
    memories = json.load(sys.stdin)
    if memories and len(memories) > 0:
        formatted = '📚 Context from previous sessions:\n'
        for i, mem in enumerate(memories[:3], 1):
            content = mem.get('content', '')[:150]
            formatted += f'{i}. {content}...\n'
        print(formatted)
except:
    pass
" 2>/dev/null || echo "")
    fi
    
    if [ -n "$MEMORY_CONTEXT" ]; then
        log_message "Memory context recalled successfully"
    else
        log_message "No relevant memories found"
    fi
fi

# Return response
if [ -n "$MEMORY_CONTEXT" ]; then
    # Return with memory context
    python3 <<EOF
import json
response = {
    "continue": True,
    "agentMessage": """$MEMORY_CONTEXT"""
}
print(json.dumps(response))
EOF
else
    # Just continue without context
    echo '{"continue": true}'
fi

log_message "Session initialization complete"

exit 0

