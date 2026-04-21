#!/bin/bash

# Claude Session Memory Capture Hook
# Automatically captures significant session milestones to Personal AI Memory
# This hook triggers on session completion and major operations

# Configuration
HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RELATIVE_PROCESSOR="$(cd "$HOOK_DIR/../scripts" 2>/dev/null && pwd)/process-session-memory.py"
MEMORY_PROCESSOR="$HOME/.claude/scripts/process-session-memory.py"
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

# Save session context to temporary file
TEMP_FILE="/tmp/claude_session_$(date +%s)_$$.json"
cleanup() {
    rm -f "$TEMP_FILE"
}
trap cleanup EXIT

AUTOMEM_PROJECT_NAME="$PROJECT_NAME" \
AUTOMEM_WORKING_DIR="$CURRENT_DIR" \
AUTOMEM_GIT_BRANCH="$GIT_BRANCH" \
AUTOMEM_GIT_REPO="$GIT_REPO" \
AUTOMEM_HOOK_TYPE="${CLAUDE_HOOK_TYPE:-session_end}" \
AUTOMEM_SESSION_ID="${CLAUDE_SESSION_ID:-unknown}" \
AUTOMEM_RECENT_COMMITS="$RECENT_COMMITS" \
AUTOMEM_FILE_CHANGES="$FILE_CHANGES" \
AUTOMEM_DIFF_STATS="$DIFF_STATS" \
AUTOMEM_STAGED_STATS="$STAGED_STATS" \
AUTOMEM_USER="$USER" \
AUTOMEM_HOSTNAME="$(hostname)" \
AUTOMEM_PLATFORM="$(uname -s)" \
AUTOMEM_TEMP_FILE="$TEMP_FILE" \
python3 - <<'PY'
import json
import os
from datetime import datetime, timezone

context = {
    "session_data": {
        "timestamp": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "project_name": os.environ.get("AUTOMEM_PROJECT_NAME", ""),
        "working_directory": os.environ.get("AUTOMEM_WORKING_DIR", ""),
        "git_branch": os.environ.get("AUTOMEM_GIT_BRANCH", ""),
        "git_repo": os.environ.get("AUTOMEM_GIT_REPO", ""),
        "hook_type": os.environ.get("AUTOMEM_HOOK_TYPE", "session_end"),
        "session_id": os.environ.get("AUTOMEM_SESSION_ID", "unknown"),
    },
    "recent_commits": os.environ.get("AUTOMEM_RECENT_COMMITS", ""),
    "file_changes": os.environ.get("AUTOMEM_FILE_CHANGES", ""),
    "diff_stats": os.environ.get("AUTOMEM_DIFF_STATS", ""),
    "staged_stats": os.environ.get("AUTOMEM_STAGED_STATS", ""),
    "environment": {
        "user": os.environ.get("AUTOMEM_USER", ""),
        "hostname": os.environ.get("AUTOMEM_HOSTNAME", ""),
        "platform": os.environ.get("AUTOMEM_PLATFORM", ""),
    },
}

temp_file = os.environ.get("AUTOMEM_TEMP_FILE")
if temp_file:
    with open(temp_file, "w", encoding="utf-8") as handle:
        json.dump(context, handle, indent=2)
PY

log_message "Session context saved to $TEMP_FILE"

# Process the session data with Python script
if [ -f "$MEMORY_PROCESSOR" ]; then
    log_message "Processing session with Python processor"
    
    PROCESS_TIMEOUT=10
    python3 "$MEMORY_PROCESSOR" "$TEMP_FILE" >> "$LOG_FILE" 2>&1 &
    PROCESS_PID=$!
    RESULT=0

    while kill -0 "$PROCESS_PID" 2>/dev/null; do
        if [ "$PROCESS_TIMEOUT" -le 0 ]; then
            log_message "Session memory processing timed out"
            kill "$PROCESS_PID" 2>/dev/null
            wait "$PROCESS_PID" 2>/dev/null
            RESULT=124
            break
        fi
        sleep 1
        PROCESS_TIMEOUT=$((PROCESS_TIMEOUT - 1))
    done

    if [ "$RESULT" -eq 0 ]; then
        wait "$PROCESS_PID"
        RESULT=$?
    fi
    
    if [ $RESULT -eq 0 ]; then
        log_message "Session memory processed successfully"
    else
        log_message "Session memory processing failed with code $RESULT"
    fi
    
else
    log_message "Memory processor not found at $MEMORY_PROCESSOR"
fi

# Quick notification for user (non-blocking)
if [ -n "$FILE_CHANGES" ] || [ -n "$RECENT_COMMITS" ]; then
    echo "🧠 Session milestone captured for analysis"
fi

exit 0
