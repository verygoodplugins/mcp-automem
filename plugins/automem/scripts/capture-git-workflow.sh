#!/bin/bash

# Capture Git Workflow Hook for AutoMem
# Records git commits, GitHub issues, PRs, and code review activity

# Output Success on clean exit for consistent hook feedback
trap 'echo "Success"' EXIT

LOG_FILE="$HOME/.claude/logs/git-workflow.log"
MEMORY_QUEUE="$HOME/.claude/scripts/memory-queue.jsonl"

# Ensure directories exist
mkdir -p "$(dirname "$LOG_FILE")"
mkdir -p "$(dirname "$MEMORY_QUEUE")"

# Log function
log_message() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" >> "$LOG_FILE"
}

# Read JSON input from stdin (Claude Code hook format per docs)
INPUT_JSON=$(cat)

# Parse JSON fields using jq
COMMAND=$(echo "$INPUT_JSON" | jq -r '.tool_input.command // ""')
OUTPUT=$(echo "$INPUT_JSON" | jq -r '.tool_response // ""')
EXIT_CODE=$(echo "$INPUT_JSON" | jq -r '.tool_response | if type == "object" then (.exit_code // .exitCode // 0) else 0 end')
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
IMPORTANCE=0.7
TAGS='["git-workflow"]'

# Git commit
if echo "$COMMAND" | grep -qi "git commit"; then
    WORKFLOW_TYPE="commit"

    # Extract commit message from command (-m "message") or output (portable, no grep -P)
    COMMIT_MSG=$(echo "$COMMAND" | sed -n 's/.*-m ["\x27]\([^"\x27]*\)["\x27].*/\1/p' | head -1)
    if [ -z "$COMMIT_MSG" ]; then
        # Try to get from output (first line often has commit info)
        COMMIT_MSG=$(echo "$OUTPUT" | sed -n 's/.*\] \(.*\)/\1/p' | head -1)
    fi

    # Get branch from output or git
    BRANCH=$(echo "$OUTPUT" | sed -n 's/^\[\([^ \]]*\).*/\1/p' | head -1)

    # Get files changed count
    FILES_CHANGED=$(echo "$OUTPUT" | grep -oE '[0-9]+ files? changed' | grep -oE '^[0-9]+' | head -1)

    CONTENT="Committed to ${PROJECT_NAME}: ${COMMIT_MSG:-unknown}${BRANCH:+ on $BRANCH}${FILES_CHANGED:+ ($FILES_CHANGED files)}"
    IMPORTANCE=0.7
    TAGS="[\"git-workflow\", \"commit\", \"repo:${PROJECT_NAME}\"]"

# GitHub Issue creation
elif echo "$COMMAND" | grep -qi "gh issue create"; then
    WORKFLOW_TYPE="issue-create"

    # Extract title from command or output (portable, no grep -P)
    ISSUE_TITLE=$(echo "$COMMAND" | sed -n 's/.*--title ["\x27]\([^"\x27]*\)["\x27].*/\1/p' | head -1)
    ISSUE_URL=$(echo "$OUTPUT" | grep -oE 'https://github\.com/[^[:space:]]+' | head -1)
    ISSUE_NUM=$(echo "$ISSUE_URL" | grep -oE '[0-9]+$')

    CONTENT="Created issue #${ISSUE_NUM:-?} in ${PROJECT_NAME}: ${ISSUE_TITLE:-see URL}${ISSUE_URL:+ - $ISSUE_URL}"
    IMPORTANCE=0.7
    TAGS="[\"git-workflow\", \"issue\", \"created\", \"repo:${PROJECT_NAME}\"]"

# GitHub Issue close
elif echo "$COMMAND" | grep -qi "gh issue close"; then
    WORKFLOW_TYPE="issue-close"

    ISSUE_NUM=$(echo "$COMMAND" | sed -n 's/.*close \([0-9]*\).*/\1/p')

    CONTENT="Closed issue #${ISSUE_NUM:-?} in ${PROJECT_NAME}"
    IMPORTANCE=0.6
    TAGS="[\"git-workflow\", \"issue\", \"closed\", \"repo:${PROJECT_NAME}\"]"

# GitHub PR creation
elif echo "$COMMAND" | grep -qi "gh pr create"; then
    WORKFLOW_TYPE="pr-create"

    # Extract title and body summary (portable, no grep -P)
    PR_TITLE=$(echo "$COMMAND" | sed -n 's/.*--title ["\x27]\([^"\x27]*\)["\x27].*/\1/p' | head -1)
    PR_URL=$(echo "$OUTPUT" | grep -oE 'https://github\.com/[^[:space:]]+/pull/[0-9]+' | head -1)
    PR_NUM=$(echo "$PR_URL" | grep -oE '[0-9]+$')

    CONTENT="Created PR #${PR_NUM:-?} in ${PROJECT_NAME}: ${PR_TITLE:-see URL}${PR_URL:+ - $PR_URL}"
    IMPORTANCE=0.8
    TAGS="[\"git-workflow\", \"pr\", \"created\", \"repo:${PROJECT_NAME}\"]"

# GitHub PR merge
elif echo "$COMMAND" | grep -qi "gh pr merge"; then
    WORKFLOW_TYPE="pr-merge"

    PR_NUM=$(echo "$COMMAND" | sed -n 's/.*merge \([0-9]*\).*/\1/p')
    if [ -z "$PR_NUM" ]; then
        PR_NUM=$(echo "$OUTPUT" | grep -oE '#[0-9]+' | head -1 | tr -d '#')
    fi

    CONTENT="Merged PR #${PR_NUM:-?} in ${PROJECT_NAME}"
    IMPORTANCE=0.8
    TAGS="[\"git-workflow\", \"pr\", \"merged\", \"repo:${PROJECT_NAME}\"]"

# GitHub PR view (might contain review comments)
elif echo "$COMMAND" | grep -qi "gh pr view"; then
    WORKFLOW_TYPE="pr-view"

    # Check if output contains review comments
    if echo "$OUTPUT" | grep -qi "review\|comment\|requested changes\|approved"; then
        PR_NUM=$(echo "$COMMAND" | sed -n 's/.*view \([0-9]*\).*/\1/p')

        # Extract review status
        REVIEW_STATUS=""
        if echo "$OUTPUT" | grep -qi "approved"; then
            REVIEW_STATUS="approved"
        elif echo "$OUTPUT" | grep -qi "requested changes"; then
            REVIEW_STATUS="changes requested"
        fi

        if [ -n "$REVIEW_STATUS" ]; then
            CONTENT="PR #${PR_NUM:-?} review in ${PROJECT_NAME}: ${REVIEW_STATUS}"
            IMPORTANCE=0.7
            TAGS="[\"git-workflow\", \"pr\", \"review\", \"repo:${PROJECT_NAME}\"]"
        else
            # No significant review info, skip
            exit 0
        fi
    else
        # Just viewing PR without review info, skip
        exit 0
    fi

# GitHub API calls for PR comments/reviews
elif echo "$COMMAND" | grep -qi "gh api.*pulls.*comments\|gh api.*pulls.*reviews"; then
    WORKFLOW_TYPE="pr-review-api"

    # Extract PR number from API path (portable, no grep -P)
    PR_NUM=$(echo "$COMMAND" | sed -n 's/.*pulls\/\([0-9]*\).*/\1/p')

    # Check for meaningful review content
    if echo "$OUTPUT" | grep -qi "body\|comment\|state"; then
        CONTENT="Fetched PR #${PR_NUM:-?} review data in ${PROJECT_NAME}"
        IMPORTANCE=0.6
        TAGS="[\"git-workflow\", \"pr\", \"review\", \"api\", \"repo:${PROJECT_NAME}\"]"
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

# Queue memory for processing
TIMESTAMP=$(date -u "+%Y-%m-%dT%H:%M:%SZ")

MEMORY_RECORD=$(jq -cn \
    --arg content "$CONTENT" \
    --arg type "$WORKFLOW_TYPE" \
    --arg project "$PROJECT_NAME" \
    --arg command "$COMMAND" \
    --arg timestamp "$TIMESTAMP" \
    --argjson importance "$IMPORTANCE" \
    --argjson tags "$TAGS" \
    '{
      content: $content,
      tags: $tags,
      importance: $importance,
      type: "Context",
      metadata: {
        workflow_type: $type,
        project: $project,
        command: $command
      },
      timestamp: $timestamp
    }')

# Write to queue with file locking
(
    flock -x 200
    echo "$MEMORY_RECORD" >> "$MEMORY_QUEUE"
) 200>"${MEMORY_QUEUE}.lock"

log_message "Queued $WORKFLOW_TYPE memory: $CONTENT"

# Quick feedback
case "$WORKFLOW_TYPE" in
    commit)      echo "🧠 Commit captured" ;;
    pr-create)   echo "🧠 PR creation captured" ;;
    pr-merge)    echo "🧠 PR merge captured" ;;
    issue-*)     echo "🧠 Issue activity captured" ;;
    pr-review*)  echo "🧠 PR review captured" ;;
esac

exit 0
