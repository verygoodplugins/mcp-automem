#!/bin/bash

# Cursor Shell Execution Audit Hook
# Triggered on beforeShellExecution - audits and queues significant shell commands
# Input: JSON via stdin with { "command": "...", "cwd": "..." }
# Output: JSON with { "permission": "allow", "userMessage": "", "agentMessage": "" }

# Configuration
QUEUE_FILE="$HOME/.cursor/memory-queue.jsonl"
LOG_FILE="$HOME/.cursor/logs/hooks.log"

# Ensure directories exist
mkdir -p "$(dirname "$QUEUE_FILE")" "$(dirname "$LOG_FILE")"

# Rotate log if it's too large (> 10MB)
if [ -f "$LOG_FILE" ] && [ $(stat -f%z "$LOG_FILE" 2>/dev/null || stat -c%s "$LOG_FILE" 2>/dev/null || echo 0) -gt 10485760 ]; then
    mv "$LOG_FILE" "$LOG_FILE.old"
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] [audit-shell] Log rotated (previous log saved to hooks.log.old)" > "$LOG_FILE"
fi

# Log function
log_message() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] [audit-shell] $1" >> "$LOG_FILE"
}

log_message "Shell execution audit hook triggered"

# Read JSON input from stdin
INPUT=$(cat)

# Parse input
COMMAND=$(echo "$INPUT" | jq -r '.command // ""' 2>/dev/null || echo "")
CWD=$(echo "$INPUT" | jq -r '.cwd // ""' 2>/dev/null || echo "")
CONVERSATION_ID=$(echo "$INPUT" | jq -r '.conversation_id // ""' 2>/dev/null || echo "")

if [ -z "$COMMAND" ]; then
    log_message "No command provided, allowing"
    echo '{"permission": "allow"}'
    exit 0
fi

log_message "Auditing command: $COMMAND"

# Get project context
PROJECT_NAME=$(basename "${CWD:-$(pwd)}")

if [ -f "${CWD}/package.json" ]; then
    PKG_NAME=$(jq -r '.name // ""' "${CWD}/package.json" 2>/dev/null | sed 's/@.*\///')
    if [ -n "$PKG_NAME" ]; then
        PROJECT_NAME="$PKG_NAME"
    fi
fi

# Check if command is significant (git commit, deploy, build, etc.)
SHOULD_QUEUE=false
IMPORTANCE=0.6
COMMAND_TYPE="shell"

case "$COMMAND" in
    *"git commit"*)
        SHOULD_QUEUE=true
        IMPORTANCE=0.8
        COMMAND_TYPE="git-commit"
        log_message "Git commit detected"
        ;;
    *"git push"*)
        SHOULD_QUEUE=true
        IMPORTANCE=0.7
        COMMAND_TYPE="git-push"
        log_message "Git push detected"
        ;;
    *"npm run build"*|*"yarn build"*|*"pnpm build"*)
        SHOULD_QUEUE=true
        IMPORTANCE=0.6
        COMMAND_TYPE="build"
        log_message "Build command detected"
        ;;
    *"npm test"*|*"yarn test"*|*"pnpm test"*|*"pytest"*|*"jest"*)
        SHOULD_QUEUE=true
        IMPORTANCE=0.6
        COMMAND_TYPE="test"
        log_message "Test command detected"
        ;;
    *"deploy"*|*"railway"*|*"vercel"*|*"netlify"*)
        SHOULD_QUEUE=true
        IMPORTANCE=0.9
        COMMAND_TYPE="deploy"
        log_message "Deploy command detected"
        ;;
    *"docker build"*|*"docker-compose"*)
        SHOULD_QUEUE=true
        IMPORTANCE=0.7
        COMMAND_TYPE="docker"
        log_message "Docker command detected"
        ;;
esac

# Queue if significant
if [ "$SHOULD_QUEUE" = true ]; then
    TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
    
    MEMORY_ENTRY=$(python3 <<EOF
import json

memory_entry = {
    "content": "Executed: $COMMAND",
    "tags": ["$PROJECT_NAME", "cursor", "$COMMAND_TYPE"],
    "importance": $IMPORTANCE,
    "type": "shell_execution",
    "timestamp": "$TIMESTAMP",
    "metadata": {
        "command": """$COMMAND""",
        "cwd": "$CWD",
        "command_type": "$COMMAND_TYPE",
        "conversation_id": "$CONVERSATION_ID"
    }
}

print(json.dumps(memory_entry))
EOF
)
    
    echo "$MEMORY_ENTRY" >> "$QUEUE_FILE" 2>/dev/null || true
    
    log_message "Command queued: $COMMAND_TYPE"
    log_message "Memory: $MEMORY_ENTRY"
fi

# Always allow (we're just auditing, not blocking)
echo '{"permission": "allow"}'

exit 0

