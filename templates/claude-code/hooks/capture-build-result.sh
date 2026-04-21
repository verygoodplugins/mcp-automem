#!/bin/bash

# Capture Build Result Hook for AutoMem
# Records build outcomes, errors, and optimization patterns

LOG_FILE="$HOME/.claude/logs/build-results.log"
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
BUILD_TOOL="unknown"

# Skip non-build commands
if [ -z "$COMMAND" ] || ! echo "$COMMAND" | grep -qiE "(^|\\s)(npm (run )?build|yarn build|pnpm build|vite build|webpack|rollup|parcel|go build|cargo build|gradle|mvn|make|composer)"; then
    exit 0
fi

# Detect build tool
if echo "$COMMAND" | grep -q "npm run build\|npm build"; then
    BUILD_TOOL="npm"
elif echo "$COMMAND" | grep -q "yarn build"; then
    BUILD_TOOL="yarn"
elif echo "$COMMAND" | grep -q "pnpm build"; then
    BUILD_TOOL="pnpm"
elif echo "$COMMAND" | grep -q "webpack\|vite\|rollup\|parcel"; then
    BUILD_TOOL=$(echo "$COMMAND" | grep -oE "webpack|vite|rollup|parcel" | head -1)
# cargo must be checked before go — "cargo build" contains "go build" as a substring.
elif echo "$COMMAND" | grep -q "cargo build"; then
    BUILD_TOOL="cargo"
elif echo "$COMMAND" | grep -qE "(^|[[:space:]])go build"; then
    BUILD_TOOL="go"
elif echo "$COMMAND" | grep -q "gradle\|mvn"; then
    BUILD_TOOL=$(echo "$COMMAND" | grep -oE "gradle|mvn" | head -1)
elif echo "$COMMAND" | grep -q "make"; then
    BUILD_TOOL="make"
elif echo "$COMMAND" | grep -q "composer"; then
    BUILD_TOOL="composer"
fi

# Analyze build results
BUILD_TIME=""
BUILD_SIZE=""
WARNINGS=0
ERRORS=0

# Extract build metrics
if [ "$BUILD_TOOL" = "npm" ] || [ "$BUILD_TOOL" = "yarn" ]; then
    BUILD_TIME=$(echo "$OUTPUT" | grep -oE "in [0-9.]+s" | grep -oE "[0-9.]+" | head -1)
    BUILD_SIZE=$(echo "$OUTPUT" | grep -oE "[0-9.]+ [KMG]B" | head -1)
    WARNINGS=$(echo "$OUTPUT" | grep -c "warning" | head -1 || true)
    WARNINGS="${WARNINGS:-0}"
elif [ "$BUILD_TOOL" = "webpack" ] || [ "$BUILD_TOOL" = "vite" ]; then
    BUILD_TIME=$(echo "$OUTPUT" | grep -oE "built in [0-9.]+s" | grep -oE "[0-9.]+" | head -1)
    BUILD_SIZE=$(echo "$OUTPUT" | grep -oE "dist.*[0-9.]+ [KMG]B" | grep -oE "[0-9.]+ [KMG]B" | head -1)
fi

# Count errors
ERRORS=$(echo "$OUTPUT" | grep -c -E "ERROR|error:|Error:" | head -1 || true)
ERRORS="${ERRORS:-0}"

# Determine importance and type
IMPORTANCE=0.5
MEMORY_TYPE="Context"

if [ "$EXIT_CODE" -ne 0 ]; then
    IMPORTANCE=0.9  # Build failures are critical
    MEMORY_TYPE="Insight"
elif [ "$ERRORS" -gt 0 ]; then
    IMPORTANCE=0.8
    MEMORY_TYPE="Insight"
elif [ "$WARNINGS" -gt 5 ]; then
    IMPORTANCE=0.6
    MEMORY_TYPE="Pattern"
elif [ -n "$BUILD_TIME" ] && [ -n "$BUILD_SIZE" ]; then
    IMPORTANCE=0.5
    MEMORY_TYPE="Context"
fi

# Extract error details if build failed
ERROR_DETAILS=""
if [ "$EXIT_CODE" -ne 0 ] || [ "$ERRORS" -gt 0 ]; then
    # Get first few error lines
    ERROR_DETAILS=$(echo "$OUTPUT" | grep -A 2 -E "ERROR|error:|Error:" | head -10)
fi

# Create memory content
if [ "$EXIT_CODE" -eq 0 ]; then
    METRICS=""
    [ -n "$BUILD_TIME" ] && METRICS="time: ${BUILD_TIME}s"
    [ -n "$BUILD_SIZE" ] && METRICS="$METRICS, size: $BUILD_SIZE"
    [ "$WARNINGS" -gt 0 ] && METRICS="$METRICS, warnings: $WARNINGS"

    CONTENT="Build succeeded in $PROJECT_NAME using $BUILD_TOOL${METRICS:+ ($METRICS)}"
else
    CONTENT="Build failed in $PROJECT_NAME using $BUILD_TOOL: $ERRORS errors. ${ERROR_DETAILS:0:200}"
fi

# Queue memory for processing with safe JSON encoding and file locking
AUTOMEM_QUEUE="$MEMORY_QUEUE" \
AUTOMEM_CONTENT="$CONTENT" \
AUTOMEM_BUILD_TOOL="$BUILD_TOOL" \
AUTOMEM_PROJECT="$PROJECT_NAME" \
AUTOMEM_IMPORTANCE="$IMPORTANCE" \
AUTOMEM_TYPE="$MEMORY_TYPE" \
AUTOMEM_BUILD_TIME="$BUILD_TIME" \
AUTOMEM_BUILD_SIZE="$BUILD_SIZE" \
AUTOMEM_WARNINGS="$WARNINGS" \
AUTOMEM_ERRORS="$ERRORS" \
AUTOMEM_EXIT_CODE="$EXIT_CODE" \
AUTOMEM_COMMAND="$COMMAND" \
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
build_tool = os.environ.get("AUTOMEM_BUILD_TOOL", "unknown")
exit_code = to_int(os.environ.get("AUTOMEM_EXIT_CODE", "0"))

# Map build_tool → best-guess bare language tag (covers the common cases).
TOOL_TO_LANG = {
    "npm": "typescript", "yarn": "typescript", "pnpm": "typescript",
    "webpack": "typescript", "vite": "typescript", "rollup": "typescript", "parcel": "typescript",
    "go": "go", "cargo": "rust", "gradle": "java", "mvn": "java",
    "make": "c", "composer": "php",
}
lang = TOOL_TO_LANG.get(build_tool)

# Bare-tag convention (matches existing corpus). No namespace prefixes.
tags = ["build"]
if build_tool and build_tool != "unknown":
    tags.append(build_tool)
if lang:
    tags.append(lang)
if project:
    tags.append(project)
if exit_code != 0:
    tags.append("failure")

record = {
    "content": truncate(os.environ.get("AUTOMEM_CONTENT", ""), 1500),
    "tags": tags,
    "importance": float(os.environ.get("AUTOMEM_IMPORTANCE", "0.5")),
    "type": os.environ.get("AUTOMEM_TYPE", "Context"),
    "metadata": {
        "build_tool": os.environ.get("AUTOMEM_BUILD_TOOL", "unknown"),
        "build_time": optional_text(os.environ.get("AUTOMEM_BUILD_TIME", "")),
        "build_size": optional_text(os.environ.get("AUTOMEM_BUILD_SIZE", "")),
        "warnings": to_int(os.environ.get("AUTOMEM_WARNINGS", "0")),
        "errors": to_int(os.environ.get("AUTOMEM_ERRORS", "0")),
        "exit_code": to_int(os.environ.get("AUTOMEM_EXIT_CODE", "0")),
        "command": truncate(os.environ.get("AUTOMEM_COMMAND", ""), 500),
        "project": os.environ.get("AUTOMEM_PROJECT", ""),
    },
    "timestamp": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
}

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
log_message "Build result captured: exit_code=$EXIT_CODE, errors=$ERRORS, warnings=$WARNINGS"

# Quick feedback
if [ "$EXIT_CODE" -ne 0 ]; then
    echo "🧠 Build failure captured for analysis"
elif [ "$WARNINGS" -gt 0 ]; then
    echo "⚠️ Build warnings recorded for improvement"
else
    echo "✅ Successful build metrics stored"
fi

exit 0
