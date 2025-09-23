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

# Get build context
COMMAND="${CLAUDE_LAST_COMMAND:-build}"
OUTPUT="${CLAUDE_COMMAND_OUTPUT:-}"
EXIT_CODE="${CLAUDE_EXIT_CODE:-0}"
PROJECT_NAME=$(basename "$(pwd)")
BUILD_TOOL="unknown"

# Detect build tool
if echo "$COMMAND" | grep -q "npm run build\|npm build"; then
    BUILD_TOOL="npm"
elif echo "$COMMAND" | grep -q "yarn build"; then
    BUILD_TOOL="yarn"
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
    ERROR_DETAILS=$(echo "$OUTPUT" | grep -A 2 -E "ERROR|error:|Error:" | head -10 | tr '\n' ' ' | sed 's/"/\\"/g')
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

# Create memory record
MEMORY_RECORD=$(cat <<EOF
{
  "content": "$CONTENT",
  "tags": ["build", "$BUILD_TOOL", "$PROJECT_NAME", "$(date +%Y-%m)"],
  "importance": $IMPORTANCE,
  "type": "$MEMORY_TYPE",
  "metadata": {
    "build_tool": "$BUILD_TOOL",
    "build_time": "${BUILD_TIME:-null}",
    "build_size": "${BUILD_SIZE:-null}",
    "warnings": $WARNINGS,
    "errors": $ERRORS,
    "exit_code": $EXIT_CODE,
    "command": "$COMMAND",
    "project": "$PROJECT_NAME",
    "timestamp": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  }
}
EOF
)

# Queue memory for processing
echo "$MEMORY_RECORD" >> "$MEMORY_QUEUE"
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