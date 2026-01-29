#!/bin/bash

# Claude Session Memory Capture Hook
# Automatically captures significant session milestones to Personal AI Memory
# This hook triggers on session completion and major operations

# Output Success on clean exit for consistent hook feedback
trap 'echo "Success"' EXIT

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
TEMP_FILE=$(mktemp "/tmp/claude_session.XXXXXX.json")
cleanup() {
    rm -f "$TEMP_FILE"
}
trap cleanup EXIT

if ! command -v jq >/dev/null 2>&1; then
    log_message "jq not available; cannot encode session context"
    exit 1
fi

TIMESTAMP=$(date -u "+%Y-%m-%dT%H:%M:%SZ")
if ! FULL_CONTEXT=$(jq -n \
    --arg timestamp "$TIMESTAMP" \
    --arg project_name "$PROJECT_NAME" \
    --arg working_directory "$CURRENT_DIR" \
    --arg git_branch "$GIT_BRANCH" \
    --arg git_repo "$GIT_REPO" \
    --arg hook_type "${CLAUDE_HOOK_TYPE:-session_end}" \
    --arg session_id "${CLAUDE_SESSION_ID:-unknown}" \
    --arg recent_commits "$RECENT_COMMITS" \
    --arg file_changes "$FILE_CHANGES" \
    --arg diff_stats "$DIFF_STATS" \
    --arg staged_stats "$STAGED_STATS" \
    --arg user "$USER" \
    --arg hostname "$(hostname)" \
    --arg platform "$(uname -s)" \
    '{
      session_data: {
        timestamp: $timestamp,
        project_name: $project_name,
        working_directory: $working_directory,
        git_branch: $git_branch,
        git_repo: $git_repo,
        hook_type: $hook_type,
        session_id: $session_id
      },
      recent_commits: $recent_commits,
      file_changes: $file_changes,
      diff_stats: $diff_stats,
      staged_stats: $staged_stats,
      environment: {
        user: $user,
        hostname: $hostname,
        platform: $platform
      }
    }'); then
    log_message "Failed to build session context via jq"
    exit 1
fi

if ! printf '%s' "$FULL_CONTEXT" > "$TEMP_FILE"; then
    log_message "Failed to write session context to $TEMP_FILE"
    exit 1
fi

log_message "Session context saved to $TEMP_FILE"

# Process the session data with Python script
if [ -f "$MEMORY_PROCESSOR" ]; then
    log_message "Processing session with Python processor"

    if ! command -v timeout >/dev/null 2>&1; then
        log_message "timeout command not found; running without timeout"
        python3 "$MEMORY_PROCESSOR" "$TEMP_FILE" >> "$LOG_FILE" 2>&1
        RESULT=$?
    else
        timeout 30s python3 "$MEMORY_PROCESSOR" "$TEMP_FILE" >> "$LOG_FILE" 2>&1
        RESULT=$?
    fi

    if [ $RESULT -eq 0 ]; then
        log_message "Session memory processed successfully"
    elif [ $RESULT -eq 124 ]; then
        log_message "Session memory processing timed out (exit $RESULT)"
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
