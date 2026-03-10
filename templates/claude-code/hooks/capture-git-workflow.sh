#!/bin/bash

# Capture Git Workflow Hook for AutoMem
# Records git commits, GitHub issues, PRs, and code review activity

# Conditional success output (only on clean exit)
SCRIPT_SUCCESS=false
trap '[ "$SCRIPT_SUCCESS" = true ] && echo "Success"' EXIT

LOG_FILE="$HOME/.claude/logs/git-workflow.log"
MEMORY_QUEUE="$HOME/.claude/scripts/memory-queue.jsonl"

# Ensure directories exist
mkdir -p "$(dirname "$LOG_FILE")"
mkdir -p "$(dirname "$MEMORY_QUEUE")"

# Log function
log_message() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" >> "$LOG_FILE"
}

# Check required dependencies
if ! command -v jq >/dev/null 2>&1; then
    echo "Warning: jq not installed - git workflow capture disabled" >&2
    exit 0
fi
if ! command -v perl >/dev/null 2>&1; then
    echo "Warning: perl not installed - git workflow capture disabled" >&2
    exit 0
fi
if ! command -v python3 >/dev/null 2>&1; then
    echo "Warning: python3 not installed - git workflow capture disabled" >&2
    exit 0
fi

# Read JSON input from stdin (Claude Code hook format per docs)
INPUT_JSON=$(cat)

# Parse JSON fields using jq
COMMAND=$(echo "$INPUT_JSON" | jq -r '.tool_input.command // ""')
OUTPUT=$(echo "$INPUT_JSON" | jq -r '.tool_response // ""')
CWD=$(echo "$INPUT_JSON" | jq -r '.cwd // ""')
PROJECT_NAME=$(basename "${CWD:-$(pwd)}")

# Skip if not a git/gh command
if [ -z "$COMMAND" ] || ! echo "$COMMAND" | grep -qiE "(git commit|gh (issue|pr|api))"; then
    exit 0
fi

log_message "Git workflow command detected: $COMMAND"

# Determine workflow type and extract details
WORKFLOW_TYPE="unknown"
CONTENT=""
IMPORTANCE=0.5  # Default, will be calculated based on signals
# TAGS will be built by jq to handle special chars in PROJECT_NAME
EXTRA_TAGS=""  # Additional tags like "commit", "pr", "issue"

# Git commit
if echo "$COMMAND" | grep -qi "git commit"; then
    WORKFLOW_TYPE="commit"

    # Get commit message from git log (works regardless of how commit was made)
    # Change to CWD if provided, otherwise use current dir
    if [ -n "$CWD" ] && [ -d "$CWD" ]; then
        COMMIT_MSG=$(cd "$CWD" && git log -1 --pretty=%s 2>/dev/null)
        BRANCH=$(cd "$CWD" && git branch --show-current 2>/dev/null)
    else
        COMMIT_MSG=$(git log -1 --pretty=%s 2>/dev/null)
        BRANCH=$(git branch --show-current 2>/dev/null)
    fi

    # Get files changed count from output (portable - no grep -P)
    FILES_CHANGED=$(echo "$OUTPUT" | perl -nle 'print $1 if /(\d+) files? changed/' | head -1)

    CONTENT="Committed to ${PROJECT_NAME}: ${COMMIT_MSG:-unknown}${BRANCH:+ on $BRANCH}${FILES_CHANGED:+ ($FILES_CHANGED files)}"
    EXTRA_TAGS="commit"

# GitHub Issue creation
elif echo "$COMMAND" | grep -qi "gh issue create"; then
    WORKFLOW_TYPE="issue-create"

    # Extract title from command or output (portable - no grep -P)
    ISSUE_TITLE=$(echo "$COMMAND" | perl -nle 'print $1 if /--title ["\x27]([^"\x27]+)/' | head -1)
    ISSUE_URL=$(echo "$OUTPUT" | perl -nle 'print $1 if m{(https://github\.com/\S+)}' | head -1)
    ISSUE_NUM=$(echo "$ISSUE_URL" | perl -nle 'print $1 if /(\d+)$/')

    CONTENT="Created issue #${ISSUE_NUM:-?} in ${PROJECT_NAME}: ${ISSUE_TITLE:-see URL}${ISSUE_URL:+ - $ISSUE_URL}"
    EXTRA_TAGS="issue,created"

# GitHub Issue close
elif echo "$COMMAND" | grep -qi "gh issue close"; then
    WORKFLOW_TYPE="issue-close"

    ISSUE_NUM=$(echo "$COMMAND" | perl -nle 'print $1 if /close (\d+)/')

    CONTENT="Closed issue #${ISSUE_NUM:-?} in ${PROJECT_NAME}"
    EXTRA_TAGS="issue,closed"

# GitHub PR creation
elif echo "$COMMAND" | grep -qi "gh pr create"; then
    WORKFLOW_TYPE="pr-create"

    # Extract PR URL from output (gh pr create prints it) - portable
    PR_URL=$(echo "$OUTPUT" | perl -nle 'print $1 if m{(https://github\.com/\S+pull/\d+)}' | head -1)
    PR_NUM=$(echo "$PR_URL" | perl -nle 'print $1 if /(\d+)$/')

    # Try simple regex first (works for simple --title "text") - portable
    PR_TITLE=$(echo "$COMMAND" | perl -nle 'print $1 if /--title "([^"]+)/' | head -1)

    # Fallback: fetch from gh only if regex failed and we have PR number
    # Note: no timeout as it's not portable; gh is usually fast
    if [ -z "$PR_TITLE" ] && [ -n "$PR_NUM" ]; then
        PR_REPO=$(echo "$PR_URL" | perl -nle 'print $1 if m{github\.com/([^/]+/[^/]+)}')
        PR_TITLE=$(gh pr view "$PR_NUM" --repo "$PR_REPO" --json title -q '.title' 2>/dev/null)
    fi

    CONTENT="Created PR #${PR_NUM:-?} in ${PROJECT_NAME}: ${PR_TITLE:-$PR_URL}"
    EXTRA_TAGS="pr,created"

# GitHub PR merge
elif echo "$COMMAND" | grep -qi "gh pr merge"; then
    WORKFLOW_TYPE="pr-merge"

    PR_NUM=$(echo "$COMMAND" | perl -nle 'print $1 if /merge (\d+)/')
    if [ -z "$PR_NUM" ]; then
        PR_NUM=$(echo "$OUTPUT" | perl -nle 'print $1 if /#(\d+)/' | head -1)
    fi

    CONTENT="Merged PR #${PR_NUM:-?} in ${PROJECT_NAME}"
    EXTRA_TAGS="pr,merged"

# GitHub PR view (might contain review comments)
elif echo "$COMMAND" | grep -qi "gh pr view"; then
    WORKFLOW_TYPE="pr-view"

    # Check if output contains review comments
    if echo "$OUTPUT" | grep -qiE "review|comment|requested changes|approved"; then
        PR_NUM=$(echo "$COMMAND" | perl -nle 'print $1 if /view (\d+)/')

        # Extract review status
        REVIEW_STATUS=""
        if echo "$OUTPUT" | grep -qi "approved"; then
            REVIEW_STATUS="approved"
        elif echo "$OUTPUT" | grep -qi "requested changes"; then
            REVIEW_STATUS="changes requested"
        fi

        if [ -n "$REVIEW_STATUS" ]; then
            CONTENT="PR #${PR_NUM:-?} review in ${PROJECT_NAME}: ${REVIEW_STATUS}"
            EXTRA_TAGS="pr,review"
        else
            # No significant review info, skip
            exit 0
        fi
    else
        # Just viewing PR without review info, skip
        exit 0
    fi

# GitHub API calls for PR comments/reviews
elif echo "$COMMAND" | grep -qiE "gh api.*pulls.*comments|gh api.*pulls.*reviews"; then
    WORKFLOW_TYPE="pr-review-api"

    # Extract PR number from API path - portable
    PR_NUM=$(echo "$COMMAND" | perl -nle 'print $1 if m{pulls/(\d+)}')

    # Check for meaningful review content
    if echo "$OUTPUT" | grep -qi "body\|comment\|state"; then
        CONTENT="Fetched PR #${PR_NUM:-?} review data in ${PROJECT_NAME}"
        EXTRA_TAGS="pr,review,api"
    else
        exit 0
    fi

else
    # Unknown git workflow command, skip
    exit 0
fi

# Skip if we couldn't generate meaningful content
if [ -z "$CONTENT" ] || [ "$CONTENT" = "unknown" ]; then
    log_message "Skipping - no meaningful content extracted"
    exit 0
fi

# Truncate content to prevent "too long" errors (max 1500 chars for safety margin)
MAX_CONTENT_LEN=1500
if [ ${#CONTENT} -gt $MAX_CONTENT_LEN ]; then
    log_message "Truncating content from ${#CONTENT} to $MAX_CONTENT_LEN chars"
    CONTENT="${CONTENT:0:$MAX_CONTENT_LEN}..."
fi

# Truncate command in metadata too (heredocs can be huge)
MAX_CMD_LEN=500
if [ ${#COMMAND} -gt $MAX_CMD_LEN ]; then
    COMMAND="${COMMAND:0:$MAX_CMD_LEN}..."
fi

# Check for sensitive content (passwords, API keys, etc.) via memory-filters.json
FILTERS_FILE="${MEMORY_FILTERS:-$HOME/.claude/scripts/memory-filters.json}"
if [ -f "$FILTERS_FILE" ]; then
    while IFS= read -r pattern; do
        [ -z "$pattern" ] && continue
        if echo "$CONTENT" | grep -qiE "$pattern" 2>/dev/null; then
            log_message "Skipping - matches sensitive pattern"
            SCRIPT_SUCCESS=true
            exit 0
        fi
    done < <(jq -r '.sensitive_patterns[]?' "$FILTERS_FILE" 2>/dev/null)
fi

# Calculate importance based on signals (matches pattern from other hooks)
# Default is 0.5, boost based on workflow type and context
case "$WORKFLOW_TYPE" in
    pr-merge)
        IMPORTANCE=0.7  # Merges are significant
        ;;
    pr-create)
        IMPORTANCE=0.6  # PR creation is notable
        ;;
    commit)
        IMPORTANCE=0.5  # Standard commits
        # Boost for main/master branch
        if [[ "$BRANCH" =~ ^(main|master)$ ]]; then
            IMPORTANCE=0.7
        fi
        ;;
    issue-create)
        IMPORTANCE=0.5
        ;;
    issue-close)
        IMPORTANCE=0.5
        ;;
    pr-view|pr-review*)
        IMPORTANCE=0.5
        ;;
    *)
        IMPORTANCE=0.5
        ;;
esac

# Queue memory for processing
TIMESTAMP=$(date -u "+%Y-%m-%dT%H:%M:%SZ")

# Build tags safely using jq (handles special chars in PROJECT_NAME)
MEMORY_RECORD=$(jq -cn \
    --arg content "$CONTENT" \
    --arg type "$WORKFLOW_TYPE" \
    --arg project "$PROJECT_NAME" \
    --arg command "$COMMAND" \
    --arg timestamp "$TIMESTAMP" \
    --arg extra_tags "$EXTRA_TAGS" \
    --argjson importance "$IMPORTANCE" \
    '{
      content: $content,
      tags: (["git-workflow"] + ($extra_tags | split(",")) + ["repo:" + $project]),
      importance: $importance,
      type: "Context",
      metadata: {
        workflow_type: $type,
        project: $project,
        command: $command
      },
      timestamp: $timestamp
    }')

# Write to queue with portable file locking and dedup (Python helper)
AUTOMEM_QUEUE="$MEMORY_QUEUE" \
AUTOMEM_RECORD="$MEMORY_RECORD" \
python3 - <<'PY'
import hashlib
import json
import os

try:
    import fcntl
except ImportError:
    fcntl = None

try:
    import msvcrt
except ImportError:
    msvcrt = None

def lock_file(handle):
    if fcntl is not None:
        fcntl.flock(handle, fcntl.LOCK_EX)
        return
    if msvcrt is not None:
        handle.seek(0)
        msvcrt.locking(handle.fileno(), msvcrt.LK_LOCK, 1)

def unlock_file(handle):
    if fcntl is not None:
        fcntl.flock(handle, fcntl.LOCK_UN)
        return
    if msvcrt is not None:
        try:
            handle.seek(0)
            msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
        except OSError:
            pass

def content_hash(text):
    return hashlib.md5(text.encode("utf-8")).hexdigest()

def is_duplicate(queue_path, record_str, lookback=20):
    """Idempotency guard: skip if identical content already queued."""
    try:
        new_content = json.loads(record_str).get("content", "")
    except (json.JSONDecodeError, AttributeError):
        return False
    new_hash = content_hash(new_content)
    try:
        with open(queue_path, "r", encoding="utf-8") as f:
            for line in f.readlines()[-lookback:]:
                try:
                    if content_hash(json.loads(line.strip()).get("content", "")) == new_hash:
                        return True
                except (json.JSONDecodeError, KeyError):
                    continue
    except FileNotFoundError:
        pass
    return False

queue_path = os.environ.get("AUTOMEM_QUEUE", "")
record = os.environ.get("AUTOMEM_RECORD", "")
if queue_path and record:
    if is_duplicate(queue_path, record):
        raise SystemExit(0)  # Silently skip duplicate
    os.makedirs(os.path.dirname(queue_path), exist_ok=True)
    with open(queue_path, "a", encoding="utf-8") as handle:
        lock_file(handle)
        try:
            handle.write(record + "\n")
        finally:
            unlock_file(handle)
PY

if [ $? -ne 0 ]; then
    log_message "Failed to write memory record to queue"
    exit 1
fi

log_message "Queued $WORKFLOW_TYPE memory: $CONTENT"

# Quick feedback
case "$WORKFLOW_TYPE" in
    commit)      echo "🧠 Commit captured" ;;
    pr-create)   echo "🧠 PR creation captured" ;;
    pr-merge)    echo "🧠 PR merge captured" ;;
    issue-*)     echo "🧠 Issue activity captured" ;;
    pr-review*)  echo "🧠 PR review captured" ;;
esac

SCRIPT_SUCCESS=true
exit 0
