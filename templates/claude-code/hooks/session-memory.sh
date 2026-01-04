#!/bin/bash

# Claude Session Memory Capture Hook
# Automatically captures significant session milestones to Personal AI Memory
# This hook triggers on session completion and major operations

# Configuration
HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RELATIVE_PROCESSOR="$(cd "$HOOK_DIR/../scripts" 2>/dev/null && pwd)/process-session-memory.py"
MEMORY_PROCESSOR="$HOME/.claude/scripts/process-session-memory.py"
SESSION_STATE="$HOME/.claude/scripts/session-state.json"
LOG_FILE="$HOME/.claude/logs/session-memory.log"

if [ -f "$RELATIVE_PROCESSOR" ]; then
    MEMORY_PROCESSOR="$RELATIVE_PROCESSOR"
fi

# Ensure log directory exists
mkdir -p "$(dirname "$LOG_FILE")"

# Log function
log_message() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" >> "$LOG_FILE"
}

# Start logging
log_message "Session memory hook triggered"

# Get current working directory and project info
CURRENT_DIR=$(pwd)
PROJECT_NAME=$(basename "$CURRENT_DIR")
GIT_BRANCH=""
GIT_REPO=""

# Check if in git repository
if git rev-parse --git-dir > /dev/null 2>&1; then
    GIT_BRANCH=$(git branch --show-current 2>/dev/null || echo "unknown")
    GIT_REPO=$(git remote get-url origin 2>/dev/null | sed 's/.*[:/]\([^/]*\/[^/]*\)\.git$/\1/' || echo "local")
    log_message "Git context: repo=$GIT_REPO, branch=$GIT_BRANCH"
fi

# Collect session data
SESSION_DATA=$(cat <<EOF
{
    "timestamp": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
    "project_name": "$PROJECT_NAME",
    "working_directory": "$CURRENT_DIR",
    "git_branch": "$GIT_BRANCH",
    "git_repo": "$GIT_REPO",
    "hook_type": "${CLAUDE_HOOK_TYPE:-session_end}",
    "session_id": "${CLAUDE_SESSION_ID:-unknown}"
}
EOF
)

# Check for recent git activity
RECENT_COMMITS=""
if [ -n "$GIT_BRANCH" ]; then
    # Get commits from last hour
    RECENT_COMMITS=$(git log --since="1 hour ago" --pretty=format:"%h|%s|%an|%ad" --date=relative 2>/dev/null || echo "")
fi

# Get file changes if in git
FILE_CHANGES=""
if [ -n "$GIT_BRANCH" ]; then
    # Get both staged and unstaged changes
    FILE_CHANGES=$(git status --porcelain 2>/dev/null || echo "")
    
    # Get diff statistics
    DIFF_STATS=$(git diff --stat 2>/dev/null || echo "")
    STAGED_STATS=$(git diff --cached --stat 2>/dev/null || echo "")
fi

# Create full session context with proper JSON escaping
FULL_CONTEXT=$(python3 -c "
import json
import sys

session_data = $SESSION_DATA
recent_commits = '''$RECENT_COMMITS'''
file_changes = '''$FILE_CHANGES'''
diff_stats = '''$DIFF_STATS'''
staged_stats = '''$STAGED_STATS'''

context = {
    'session_data': session_data,
    'recent_commits': recent_commits,
    'file_changes': file_changes,
    'diff_stats': diff_stats,
    'staged_stats': staged_stats,
    'environment': {
        'user': '$USER',
        'hostname': '$(hostname)',
        'platform': '$(uname -s)'
    }
}

print(json.dumps(context, indent=2))
" 2>/dev/null || echo '{}')

# Save session context to temporary file
TEMP_FILE="/tmp/claude_session_$(date +%s).json"
echo "$FULL_CONTEXT" > "$TEMP_FILE"

log_message "Session context saved to $TEMP_FILE"

# Process the session data with Python script
if [ -f "$MEMORY_PROCESSOR" ]; then
    log_message "Processing session with Python processor"
    
    python3 "$MEMORY_PROCESSOR" "$TEMP_FILE" >> "$LOG_FILE" 2>&1
    RESULT=$?
    
    if [ $RESULT -eq 0 ]; then
        log_message "Session memory processed successfully"
    else
        log_message "Session memory processing failed with code $RESULT"
    fi
    
    # Clean up temp file
    rm -f "$TEMP_FILE"
else
    log_message "Memory processor not found at $MEMORY_PROCESSOR"
    rm -f "$TEMP_FILE"
fi

# Quick notification for user (non-blocking)
if [ -n "$FILE_CHANGES" ] || [ -n "$RECENT_COMMITS" ]; then
    echo "🧠 Session milestone captured for analysis"
fi

exit 0
