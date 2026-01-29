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

# Read JSON input from stdin (Claude Code hook format per docs)
INPUT_JSON=$(cat)

# Parse JSON fields using jq
COMMAND=$(echo "$INPUT_JSON" | jq -r '.tool_input.command // ""')
OUTPUT=$(echo "$INPUT_JSON" | jq -r '.tool_response // ""')
EXIT_CODE=$(echo "$INPUT_JSON" | jq -r '.tool_response | if type == "object" then (.exit_code // .exitCode // 0) else 0 end')
CWD=$(echo "$INPUT_JSON" | jq -r '.cwd // ""')
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
elif echo "$COMMAND" | grep -q "go build"; then
    BUILD_TOOL="go"
elif echo "$COMMAND" | grep -q "cargo build"; then
    BUILD_TOOL="cargo"
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
    WARNINGS=$(echo "$OUTPUT" | grep -c "warning" || echo 0)
elif [ "$BUILD_TOOL" = "webpack" ] || [ "$BUILD_TOOL" = "vite" ]; then
    BUILD_TIME=$(echo "$OUTPUT" | grep -oE "built in [0-9.]+s" | grep -oE "[0-9.]+" | head -1)
    BUILD_SIZE=$(echo "$OUTPUT" | grep -oE "dist.*[0-9.]+ [KMG]B" | grep -oE "[0-9.]+ [KMG]B" | head -1)
fi

# Count errors
ERRORS=$(echo "$OUTPUT" | grep -c -E "ERROR|error:|Error:" || echo 0)

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

record = {
    "content": os.environ.get("AUTOMEM_CONTENT", ""),
    "tags": ["build", os.environ.get("AUTOMEM_BUILD_TOOL", "unknown"), os.environ.get("AUTOMEM_PROJECT", "")],
    "importance": float(os.environ.get("AUTOMEM_IMPORTANCE", "0.5")),
    "type": os.environ.get("AUTOMEM_TYPE", "Context"),
    "metadata": {
        "build_tool": os.environ.get("AUTOMEM_BUILD_TOOL", "unknown"),
        "build_time": optional_text(os.environ.get("AUTOMEM_BUILD_TIME", "")),
        "build_size": optional_text(os.environ.get("AUTOMEM_BUILD_SIZE", "")),
        "warnings": to_int(os.environ.get("AUTOMEM_WARNINGS", "0")),
        "errors": to_int(os.environ.get("AUTOMEM_ERRORS", "0")),
        "exit_code": to_int(os.environ.get("AUTOMEM_EXIT_CODE", "0")),
        "command": os.environ.get("AUTOMEM_COMMAND", ""),
        "project": os.environ.get("AUTOMEM_PROJECT", ""),
    },
    "timestamp": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
}

queue_path = os.environ.get("AUTOMEM_QUEUE", "")
if queue_path:
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
