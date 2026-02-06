#!/bin/bash

# Capture Deployment Hook for AutoMem
# Records deployment activities, environments, and outcomes

# Conditional success output (only on clean exit)
SCRIPT_SUCCESS=false
trap '[ "$SCRIPT_SUCCESS" = true ] && echo "Success"' EXIT

LOG_FILE="$HOME/.claude/logs/deployments.log"
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
    echo "Warning: jq not installed - deployment capture disabled" >&2
    exit 0
fi
if ! command -v python3 >/dev/null 2>&1; then
    echo "Warning: python3 not installed - deployment capture disabled" >&2
    exit 0
fi

# Read JSON input from stdin (Claude Code hook format per docs)
INPUT_JSON=$(cat)

# Parse JSON fields using jq
COMMAND=$(echo "$INPUT_JSON" | jq -r '.tool_input.command // ""')
OUTPUT=$(echo "$INPUT_JSON" | jq -r '.tool_response // ""')
# Ensure EXIT_CODE is numeric (default 0 if missing or non-numeric)
EXIT_CODE=$(echo "$INPUT_JSON" | jq '.tool_response | if type == "object" then (.exit_code // .exitCode // 0) else 0 end | tonumber' 2>/dev/null || echo 0)
CWD=$(echo "$INPUT_JSON" | jq -r '.cwd // ""')
PROJECT_NAME=$(basename "${CWD:-$(pwd)}")

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
DEPLOY_PLATFORM="${DEPLOY_PLATFORM:-unknown}"
DEPLOY_ENV="${DEPLOY_ENV:-production}"
PROJECT_NAME="${PROJECT_NAME:-unknown}"
IMPORTANCE="${IMPORTANCE:-0.8}"
EXIT_CODE="${EXIT_CODE:-0}"
TIMESTAMP=$(date -u "+%Y-%m-%dT%H:%M:%SZ")

# Truncate to prevent "too long" errors
CONTENT="${CONTENT:0:1500}"
COMMAND="${COMMAND:0:500}"
ERROR_DETAILS="${ERROR_DETAILS:0:500}"

if ! MEMORY_RECORD=$(jq -c -n \
    --arg content "$CONTENT" \
    --arg platform "$DEPLOY_PLATFORM" \
    --arg env "$DEPLOY_ENV" \
    --arg project "$PROJECT_NAME" \
    --arg type "$MEMORY_TYPE" \
    --arg url "$DEPLOY_URL" \
    --arg version "$VERSION" \
    --arg build_id "$BUILD_ID" \
    --arg deploy_time "$DEPLOY_TIME" \
    --arg git_commit "$GIT_COMMIT" \
    --arg command "$COMMAND" \
    --arg error_details "$ERROR_DETAILS" \
    --arg timestamp "$TIMESTAMP" \
    --argjson importance "$IMPORTANCE" \
    --argjson exit_code "$EXIT_CODE" \
    'def optional($value): if $value == "" then null else $value end;
    {
      content: $content,
      tags: ["deployment", "platform:\($platform)", "env:\($env)", "project:\($project)"],
      importance: $importance,
      type: $type,
      metadata: {
        platform: $platform,
        environment: $env,
        url: optional($url),
        version: optional($version),
        build_id: optional($build_id),
        deploy_time: optional($deploy_time),
        git_commit: optional($git_commit),
        exit_code: $exit_code,
        command: $command,
        project: $project,
        error_details: optional($error_details)
      },
      timestamp: $timestamp
    }'); then
    log_message "Failed to build deployment memory record"
    exit 1
fi

AUTOMEM_QUEUE="$MEMORY_QUEUE" \
AUTOMEM_RECORD="$MEMORY_RECORD" \
python3 - <<'PY'
import os

try:
    import fcntl  # type: ignore[attr-defined]
except ImportError:
    fcntl = None

try:
    import msvcrt  # type: ignore[import-not-found]
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

queue_path = os.environ.get("AUTOMEM_QUEUE", "")
record = os.environ.get("AUTOMEM_RECORD", "")
if queue_path and record:
    os.makedirs(os.path.dirname(queue_path), exist_ok=True)
    with open(queue_path, "a", encoding="utf-8") as handle:
        lock_file(handle)
        try:
            handle.write(record + "\n")
        finally:
            unlock_file(handle)
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

SCRIPT_SUCCESS=true
exit 0
