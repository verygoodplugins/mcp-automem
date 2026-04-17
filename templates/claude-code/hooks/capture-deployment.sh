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

# Check required dependencies
if ! command -v jq >/dev/null 2>&1; then
    echo "Warning: jq not installed - capture disabled" >&2
    exit 0
fi

if ! command -v python3 >/dev/null 2>&1; then
    echo "Warning: python3 not installed - capture disabled" >&2
    exit 0
fi

# Read JSON input from stdin (Claude Code hook format)
INPUT_JSON=$(cat)

# Parse JSON fields, fall back to env vars for backward compat
COMMAND=$(echo "$INPUT_JSON" | jq -r '.tool_input.command // empty' 2>/dev/null)
COMMAND="${COMMAND:-${CLAUDE_LAST_COMMAND:-${CLAUDE_CONTEXT:-${TOOL_NAME:-}}}}"
OUTPUT=$(echo "$INPUT_JSON" | jq -r '.tool_response // empty' 2>/dev/null)
OUTPUT="${OUTPUT:-${CLAUDE_COMMAND_OUTPUT:-${TOOL_RESULT:-}}}"
EXIT_CODE=$(echo "$INPUT_JSON" | jq -r '.tool_response | if type == "object" then (.exit_code // .exitCode // 0) else 0 end' 2>/dev/null)
EXIT_CODE="${EXIT_CODE:-${CLAUDE_EXIT_CODE:-0}}"
CWD=$(echo "$INPUT_JSON" | jq -r '.cwd // empty' 2>/dev/null)
PROJECT_NAME=$(basename "${CWD:-$(pwd)}")

# Skip non-deploy commands. Guard against read-only CLIs that mention platform names
# in URLs or output (e.g. `curl https://x.up.railway.app/health`, `docker ps`).
if [ -z "$COMMAND" ]; then
    exit 0
fi

FIRST_WORD=$(echo "$COMMAND" | awk '{print $1}' | tr -d '"'"'")
case "$FIRST_WORD" in
    curl|wget|http|ping|dig|nslookup|nc|netcat|cat|ls|grep|rg|find|jq|which|type|echo|awk|sed|head|tail)
        exit 0
        ;;
esac

# Require either explicit "deploy" word OR a platform+action combination that
# actually deploys something (not just a status check or query).
DEPLOY_REGEX='\bdeploy(ed|ing|ment|s)?\b'
PLATFORM_ACTION_REGEX='\b(railway\s+(up|redeploy|run)|vercel(\s+(--prod|deploy))?|netlify\s+deploy|heroku\s+(create|releases:create|run)|git\s+push\s+heroku|kubectl\s+(apply|rollout|set\s+image|create|replace)|docker\s+(push|buildx\s+build\s+.*--push)|gcloud\s+(run|app|builds|functions|compute)\s+(deploy|submit)|firebase\s+deploy|gh\s+(pages|workflow\s+run)|flyctl\s+deploy|fly\s+deploy)\b'

if ! echo "$COMMAND" | grep -qiE "$DEPLOY_REGEX" && ! echo "$COMMAND" | grep -qiE "$PLATFORM_ACTION_REGEX"; then
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

# Determine importance + type. Only valid AutoMem types: Decision|Pattern|Preference|Style|Habit|Insight|Context.
# A deploy event is Context (successful) or Insight (failure analysis) — never Decision.
IMPORTANCE=0.8
MEMORY_TYPE="Context"

if [ "$EXIT_CODE" -ne 0 ]; then
    IMPORTANCE=0.95
    MEMORY_TYPE="Insight"
elif [ "$DEPLOY_ENV" = "production" ]; then
    IMPORTANCE=0.9
    MEMORY_TYPE="Context"
elif [ "$DEPLOY_ENV" = "staging" ]; then
    IMPORTANCE=0.7
else
    IMPORTANCE=0.6
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
import hashlib
import json
import os
from datetime import datetime, timezone

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

def optional_text(value):
    return value if value else None

def to_int(value, default=0):
    try:
        return int(value)
    except (TypeError, ValueError):
        return default

def truncate(text, max_len):
    """Truncate text to max_len to prevent oversized queue entries."""
    if text and len(text) > max_len:
        return text[:max_len] + "..."
    return text

def content_hash(text):
    return hashlib.md5(text.encode("utf-8")).hexdigest()

def is_duplicate(queue_path, new_content, lookback=20):
    """Skip if identical content already queued recently."""
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

project = os.environ.get("AUTOMEM_PROJECT", "")
platform = os.environ.get("AUTOMEM_DEPLOY_PLATFORM", "unknown")
deploy_env = os.environ.get("AUTOMEM_DEPLOY_ENV", "production")
exit_code = to_int(os.environ.get("AUTOMEM_EXIT_CODE", "0"))

# Bare-tag convention (matches existing corpus). No namespace prefixes.
tags = ["deployment"]
if platform and platform != "unknown":
    tags.append(platform)
tags.append(deploy_env)
if project:
    tags.append(project)
if exit_code != 0:
    tags.append("failure")

now_iso = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")

record = {
    "content": truncate(os.environ.get("AUTOMEM_CONTENT", ""), 1500),
    "tags": tags,
    "importance": float(os.environ.get("AUTOMEM_IMPORTANCE", "0.8")),
    "type": os.environ.get("AUTOMEM_TYPE", "Context"),
    "metadata": {
        "platform": platform,
        "environment": deploy_env,
        "url": optional_text(os.environ.get("AUTOMEM_DEPLOY_URL", "")),
        "version": optional_text(os.environ.get("AUTOMEM_VERSION", "")),
        "build_id": optional_text(os.environ.get("AUTOMEM_BUILD_ID", "")),
        "deploy_time": optional_text(os.environ.get("AUTOMEM_DEPLOY_TIME", "")),
        "git_commit": optional_text(os.environ.get("AUTOMEM_GIT_COMMIT", "")),
        "exit_code": exit_code,
        "command": truncate(os.environ.get("AUTOMEM_COMMAND", ""), 500),
        "project": project,
        "error_details": os.environ.get("AUTOMEM_ERROR_DETAILS", ""),
    },
    "timestamp": now_iso,
}

# Temporal validity: production deployments represent the *currently live* version
# from this moment forward. No t_invalid since we don't know when it'll be replaced.
if deploy_env == "production" and exit_code == 0:
    record["t_valid"] = now_iso

queue_path = os.environ.get("AUTOMEM_QUEUE", "")
if queue_path:
    if is_duplicate(queue_path, record["content"]):
        raise SystemExit(0)
    os.makedirs(os.path.dirname(queue_path), exist_ok=True)
    with open(queue_path, "a", encoding="utf-8") as handle:
        lock_file(handle)
        try:
            handle.write(json.dumps(record, ensure_ascii=True) + "\n")
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

exit 0
