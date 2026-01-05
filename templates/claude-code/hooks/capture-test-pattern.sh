#!/bin/bash

# Capture Test Pattern Hook for AutoMem
# Records test execution patterns, results, and learned testing approaches

LOG_FILE="$HOME/.claude/logs/test-patterns.log"
MEMORY_QUEUE="$HOME/.claude/scripts/memory-queue.jsonl"

# Ensure directories exist
mkdir -p "$(dirname "$LOG_FILE")"
mkdir -p "$(dirname "$MEMORY_QUEUE")"

# Log function
log_message() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" >> "$LOG_FILE"
}

# Get test context from command output
COMMAND="${CLAUDE_LAST_COMMAND:-${CLAUDE_CONTEXT:-${TOOL_NAME:-}}}"
OUTPUT="${CLAUDE_COMMAND_OUTPUT:-${TOOL_RESULT:-}}"
EXIT_CODE="${CLAUDE_EXIT_CODE:-0}"
PROJECT_NAME=$(basename "$(pwd)")

# Skip non-test commands
if [ -z "$COMMAND" ] || ! echo "$COMMAND" | grep -qiE "(^|\\s)(npm test|yarn test|pnpm test|vitest|jest|pytest|python .*test|go test|cargo test|phpunit)"; then
    exit 0
fi

# Analyze test results
TESTS_PASSED=0
TESTS_FAILED=0
TEST_FRAMEWORK="unknown"

# Detect test framework and parse results
if echo "$COMMAND" | grep -q "pytest\|python.*test"; then
    TEST_FRAMEWORK="pytest"
    TESTS_PASSED=$(echo "$OUTPUT" | grep -oE "[0-9]+ passed" | grep -oE "[0-9]+" | head -1)
    TESTS_PASSED="${TESTS_PASSED:-0}"
    TESTS_FAILED=$(echo "$OUTPUT" | grep -oE "[0-9]+ failed" | grep -oE "[0-9]+" | head -1)
    TESTS_FAILED="${TESTS_FAILED:-0}"
elif echo "$COMMAND" | grep -q "npm test\|jest\|vitest"; then
    TEST_FRAMEWORK="jest/vitest"
    TESTS_PASSED=$(echo "$OUTPUT" | grep -oE "Tests:.*[0-9]+ passed" | grep -oE "[0-9]+ passed" | grep -oE "[0-9]+" | head -1)
    TESTS_PASSED="${TESTS_PASSED:-0}"
    TESTS_FAILED=$(echo "$OUTPUT" | grep -oE "Tests:.*[0-9]+ failed" | grep -oE "[0-9]+ failed" | grep -oE "[0-9]+" | head -1)
    TESTS_FAILED="${TESTS_FAILED:-0}"
elif echo "$COMMAND" | grep -q "go test"; then
    TEST_FRAMEWORK="go"
    TESTS_PASSED=$(echo "$OUTPUT" | grep -c "PASS" || echo 0)
    TESTS_FAILED=$(echo "$OUTPUT" | grep -c "FAIL" || echo 0)
elif echo "$COMMAND" | grep -q "phpunit"; then
    TEST_FRAMEWORK="phpunit"
    # Parse PHPUnit output
    TESTS_PASSED=$(echo "$OUTPUT" | grep -oE "OK \([0-9]+ test" | grep -oE "[0-9]+" | head -1)
    TESTS_PASSED="${TESTS_PASSED:-0}"
    TESTS_FAILED=$(echo "$OUTPUT" | grep -oE "FAILURES.*Tests: [0-9]+" | grep -oE "[0-9]+" | tail -1)
    TESTS_FAILED="${TESTS_FAILED:-0}"
fi

# Calculate test significance
IMPORTANCE=0.5
if [ "$TESTS_FAILED" -gt 0 ]; then
    IMPORTANCE=0.8  # Failed tests are important to remember
    MEMORY_TYPE="Insight"
elif [ "$TESTS_PASSED" -gt 10 ]; then
    IMPORTANCE=0.6  # Large test suites passing
    MEMORY_TYPE="Pattern"
else
    MEMORY_TYPE="Context"
fi

# Extract error messages if tests failed
ERROR_DETAILS=""
if [ "$TESTS_FAILED" -gt 0 ]; then
    # Extract first few error messages
    ERROR_DETAILS=$(echo "$OUTPUT" | grep -A 2 -E "FAIL|ERROR|AssertionError" | head -20)
fi

# Create memory content
if [ "$EXIT_CODE" -eq 0 ]; then
    CONTENT="Test suite passed: $TESTS_PASSED tests in $PROJECT_NAME using $TEST_FRAMEWORK. Command: $COMMAND"
else
    CONTENT="Test failures in $PROJECT_NAME: $TESTS_FAILED failed, $TESTS_PASSED passed using $TEST_FRAMEWORK. Errors: ${ERROR_DETAILS:0:200}"
fi

# Queue memory for processing with safe JSON encoding and file locking
AUTOMEM_QUEUE="$MEMORY_QUEUE" \
AUTOMEM_CONTENT="$CONTENT" \
AUTOMEM_TEST_FRAMEWORK="$TEST_FRAMEWORK" \
AUTOMEM_PROJECT="$PROJECT_NAME" \
AUTOMEM_IMPORTANCE="$IMPORTANCE" \
AUTOMEM_TYPE="$MEMORY_TYPE" \
AUTOMEM_TESTS_PASSED="$TESTS_PASSED" \
AUTOMEM_TESTS_FAILED="$TESTS_FAILED" \
AUTOMEM_EXIT_CODE="$EXIT_CODE" \
AUTOMEM_COMMAND="$COMMAND" \
AUTOMEM_ERROR_DETAILS="$ERROR_DETAILS" \
python3 - <<'PY'
import json
import os
import fcntl
from datetime import datetime, timezone

def to_int(value, default=0):
    try:
        return int(value)
    except (TypeError, ValueError):
        return default

record = {
    "content": os.environ.get("AUTOMEM_CONTENT", ""),
    "tags": ["test", os.environ.get("AUTOMEM_TEST_FRAMEWORK", "unknown"), os.environ.get("AUTOMEM_PROJECT", "")],
    "importance": float(os.environ.get("AUTOMEM_IMPORTANCE", "0.5")),
    "type": os.environ.get("AUTOMEM_TYPE", "Context"),
    "metadata": {
        "test_framework": os.environ.get("AUTOMEM_TEST_FRAMEWORK", "unknown"),
        "tests_passed": to_int(os.environ.get("AUTOMEM_TESTS_PASSED", "0")),
        "tests_failed": to_int(os.environ.get("AUTOMEM_TESTS_FAILED", "0")),
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
log_message "Test pattern captured: $TESTS_PASSED passed, $TESTS_FAILED failed"

# Quick feedback
if [ "$TESTS_FAILED" -gt 0 ]; then
    echo "🧠 Test failures captured for learning"
else
    echo "✅ Test success pattern recorded"
fi

exit 0
