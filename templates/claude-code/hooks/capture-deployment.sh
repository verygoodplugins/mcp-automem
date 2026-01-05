#!/bin/bash

# Capture Deployment Hook for AutoMem
# Records deployment activities, environments, and outcomes

LOG_FILE="$HOME/.claude/logs/deployments.log"
MEMORY_QUEUE="$HOME/.claude/scripts/memory-queue.jsonl"

# Ensure directories exist
mkdir -p "$(dirname "$LOG_FILE")"
mkdir -p "$(dirname "$MEMORY_QUEUE")"

# Log function
log_message() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" >> "$LOG_FILE"
}

# Get deployment context
COMMAND="${CLAUDE_LAST_COMMAND:-${CLAUDE_CONTEXT:-${TOOL_NAME:-}}}"
OUTPUT="${CLAUDE_COMMAND_OUTPUT:-${TOOL_RESULT:-}}"
EXIT_CODE="${CLAUDE_EXIT_CODE:-0}"
PROJECT_NAME=$(basename "$(pwd)")

# Skip non-deploy commands
if [ -z "$COMMAND" ] || ! echo "$COMMAND" | grep -qiE "(^|\\s)(deploy|railway|vercel|netlify|heroku|kubectl|k8s|kubernetes|docker|gcloud|aws|cloudfront|firebase|gh pages)"; then
    exit 0
fi

# Detect deployment platform and environment
DEPLOY_PLATFORM="unknown"
DEPLOY_ENV="production"
DEPLOY_URL=""

# Check for common deployment commands
if echo "$COMMAND" | grep -q "railway"; then
    DEPLOY_PLATFORM="railway"
    DEPLOY_URL=$(echo "$OUTPUT" | grep -oE "https://.*\.up\.railway\.app" | head -1)
elif echo "$COMMAND" | grep -q "vercel\|now"; then
    DEPLOY_PLATFORM="vercel"
    DEPLOY_URL=$(echo "$OUTPUT" | grep -oE "https://.*\.vercel\.app" | head -1)
elif echo "$COMMAND" | grep -q "netlify"; then
    DEPLOY_PLATFORM="netlify"
    DEPLOY_URL=$(echo "$OUTPUT" | grep -oE "https://.*\.netlify\.(app|com)" | head -1)
elif echo "$COMMAND" | grep -q "heroku"; then
    DEPLOY_PLATFORM="heroku"
    DEPLOY_URL=$(echo "$OUTPUT" | grep -oE "https://.*\.herokuapp\.com" | head -1)
elif echo "$COMMAND" | grep -q "aws\|s3\|cloudfront"; then
    DEPLOY_PLATFORM="aws"
elif echo "$COMMAND" | grep -q "gcloud\|gcp\|firebase"; then
    DEPLOY_PLATFORM="gcp"
    DEPLOY_URL=$(echo "$OUTPUT" | grep -oE "https://.*\.web\.app" | head -1)
elif echo "$COMMAND" | grep -q "docker"; then
    DEPLOY_PLATFORM="docker"
elif echo "$COMMAND" | grep -q "kubectl\|k8s\|kubernetes"; then
    DEPLOY_PLATFORM="kubernetes"
elif echo "$COMMAND" | grep -q "gh pages\|github pages"; then
    DEPLOY_PLATFORM="github-pages"
elif echo "$COMMAND" | grep -q "rsync\|scp\|ssh.*deploy"; then
    DEPLOY_PLATFORM="ssh"
fi

# Detect environment
if echo "$COMMAND $OUTPUT" | grep -qE "staging|stage|stg"; then
    DEPLOY_ENV="staging"
elif echo "$COMMAND $OUTPUT" | grep -qE "development|develop|dev"; then
    DEPLOY_ENV="development"
elif echo "$COMMAND $OUTPUT" | grep -qE "test|testing"; then
    DEPLOY_ENV="testing"
elif echo "$COMMAND $OUTPUT" | grep -qE "preview"; then
    DEPLOY_ENV="preview"
fi

# Extract deployment metrics
DEPLOY_TIME=$(echo "$OUTPUT" | grep -oE "deployed in [0-9.]+[sm]" | grep -oE "[0-9.]+[sm]" | head -1)
BUILD_ID=$(echo "$OUTPUT" | grep -oE "Build #[0-9]+" | grep -oE "[0-9]+" | head -1)
VERSION=$(echo "$OUTPUT" | grep -oE "v[0-9.]+|version [0-9.]+" | grep -oE "[0-9.]+" | head -1)

# Determine importance
IMPORTANCE=0.8  # Deployments are generally important
MEMORY_TYPE="Context"

if [ "$EXIT_CODE" -ne 0 ]; then
    IMPORTANCE=0.95  # Failed deployments are critical
    MEMORY_TYPE="Insight"
elif [ "$DEPLOY_ENV" = "production" ]; then
    IMPORTANCE=0.9  # Production deployments are very important
    MEMORY_TYPE="Decision"
elif [ "$DEPLOY_ENV" = "staging" ]; then
    IMPORTANCE=0.7
    MEMORY_TYPE="Context"
else
    IMPORTANCE=0.6
    MEMORY_TYPE="Context"
fi

# Extract error details if deployment failed
ERROR_DETAILS=""
if [ "$EXIT_CODE" -ne 0 ]; then
    ERROR_DETAILS=$(echo "$OUTPUT" | grep -A 3 -E "ERROR|FAILED|error:|Failed" | head -10)
fi

# Create memory content
if [ "$EXIT_CODE" -eq 0 ]; then
    CONTENT="Deployed $PROJECT_NAME to $DEPLOY_ENV on $DEPLOY_PLATFORM"
    [ -n "$DEPLOY_URL" ] && CONTENT="$CONTENT: $DEPLOY_URL"
    [ -n "$VERSION" ] && CONTENT="$CONTENT (v$VERSION)"
    [ -n "$DEPLOY_TIME" ] && CONTENT="$CONTENT in $DEPLOY_TIME"
else
    CONTENT="Deployment failed for $PROJECT_NAME to $DEPLOY_ENV on $DEPLOY_PLATFORM: ${ERROR_DETAILS:0:200}"
fi

# Get git commit if available
GIT_COMMIT=""
if git rev-parse --git-dir > /dev/null 2>&1; then
    GIT_COMMIT=$(git rev-parse --short HEAD 2>/dev/null || echo "")
fi

# Queue memory for processing with safe JSON encoding and file locking
AUTOMEM_QUEUE="$MEMORY_QUEUE" \
AUTOMEM_CONTENT="$CONTENT" \
AUTOMEM_DEPLOY_PLATFORM="$DEPLOY_PLATFORM" \
AUTOMEM_DEPLOY_ENV="$DEPLOY_ENV" \
AUTOMEM_PROJECT="$PROJECT_NAME" \
AUTOMEM_IMPORTANCE="$IMPORTANCE" \
AUTOMEM_TYPE="$MEMORY_TYPE" \
AUTOMEM_DEPLOY_URL="$DEPLOY_URL" \
AUTOMEM_VERSION="$VERSION" \
AUTOMEM_BUILD_ID="$BUILD_ID" \
AUTOMEM_DEPLOY_TIME="$DEPLOY_TIME" \
AUTOMEM_GIT_COMMIT="$GIT_COMMIT" \
AUTOMEM_EXIT_CODE="$EXIT_CODE" \
AUTOMEM_COMMAND="$COMMAND" \
AUTOMEM_ERROR_DETAILS="$ERROR_DETAILS" \
python3 - <<'PY'
import json
import os
import fcntl
from datetime import datetime, timezone

def optional_text(value):
    return value if value else None

def to_int(value, default=0):
    try:
        return int(value)
    except (TypeError, ValueError):
        return default

record = {
    "content": os.environ.get("AUTOMEM_CONTENT", ""),
    "tags": [
        "deployment",
        os.environ.get("AUTOMEM_DEPLOY_PLATFORM", "unknown"),
        os.environ.get("AUTOMEM_DEPLOY_ENV", "production"),
        os.environ.get("AUTOMEM_PROJECT", ""),
    ],
    "importance": float(os.environ.get("AUTOMEM_IMPORTANCE", "0.8")),
    "type": os.environ.get("AUTOMEM_TYPE", "Context"),
    "metadata": {
        "platform": os.environ.get("AUTOMEM_DEPLOY_PLATFORM", "unknown"),
        "environment": os.environ.get("AUTOMEM_DEPLOY_ENV", "production"),
        "url": optional_text(os.environ.get("AUTOMEM_DEPLOY_URL", "")),
        "version": optional_text(os.environ.get("AUTOMEM_VERSION", "")),
        "build_id": optional_text(os.environ.get("AUTOMEM_BUILD_ID", "")),
        "deploy_time": optional_text(os.environ.get("AUTOMEM_DEPLOY_TIME", "")),
        "git_commit": optional_text(os.environ.get("AUTOMEM_GIT_COMMIT", "")),
        "exit_code": to_int(os.environ.get("AUTOMEM_EXIT_CODE", "0")),
        "command": os.environ.get("AUTOMEM_COMMAND", ""),
        "project": os.environ.get("AUTOMEM_PROJECT", ""),
        "error_details": os.environ.get("AUTOMEM_ERROR_DETAILS", ""),
    },
    "timestamp": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
}

queue_path = os.environ.get("AUTOMEM_QUEUE", "")
if queue_path:
    os.makedirs(os.path.dirname(queue_path), exist_ok=True)
    with open(queue_path, "a", encoding="utf-8") as handle:
        fcntl.flock(handle, fcntl.LOCK_EX)
        handle.write(json.dumps(record, ensure_ascii=True) + "\n")
        fcntl.flock(handle, fcntl.LOCK_UN)
PY
log_message "Deployment captured: platform=$DEPLOY_PLATFORM, env=$DEPLOY_ENV, success=$([[ $EXIT_CODE -eq 0 ]] && echo true || echo false)"

# Quick feedback
if [ "$EXIT_CODE" -ne 0 ]; then
    echo "🧠 Deployment failure captured for analysis"
elif [ "$DEPLOY_ENV" = "production" ]; then
    echo "🚀 Production deployment recorded"
else
    echo "✅ Deployment to $DEPLOY_ENV recorded"
fi

exit 0
