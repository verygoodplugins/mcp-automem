#!/bin/bash

# Capture Test Pattern Hook for AutoMem
# Records test execution patterns, results, and learned testing approaches

# Track success for conditional output
SCRIPT_SUCCESS=false
trap '[ "$SCRIPT_SUCCESS" = true ] && echo "Success"' EXIT

LOG_FILE="$HOME/.claude/logs/test-patterns.log"
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
if ! command -v jq >/dev/null 2>&1; then
    log_message "jq not available; cannot encode test memory"
    exit 1
fi

PROJECT_NAME="${PROJECT_NAME:-unknown}"
TEST_FRAMEWORK="${TEST_FRAMEWORK:-unknown}"
IMPORTANCE="${IMPORTANCE:-0.5}"
TESTS_PASSED="${TESTS_PASSED:-0}"
TESTS_FAILED="${TESTS_FAILED:-0}"
EXIT_CODE="${EXIT_CODE:-0}"
TIMESTAMP=$(date -u "+%Y-%m-%dT%H:%M:%SZ")

if ! ERROR_DETAILS_JSON=$(jq -c -n --arg error "$ERROR_DETAILS" '$error'); then
    log_message "Failed to encode test error details"
    exit 1
fi

if ! MEMORY_RECORD=$(jq -c -n \
    --arg content "$CONTENT" \
    --arg test_framework "$TEST_FRAMEWORK" \
    --arg project "$PROJECT_NAME" \
    --arg type "$MEMORY_TYPE" \
    --arg command "$COMMAND" \
    --arg timestamp "$TIMESTAMP" \
    --argjson importance "$IMPORTANCE" \
    --argjson tests_passed "$TESTS_PASSED" \
    --argjson tests_failed "$TESTS_FAILED" \
    --argjson exit_code "$EXIT_CODE" \
    --argjson error_details "$ERROR_DETAILS_JSON" \
    '{
      content: $content,
      tags: ["test", "framework:\($test_framework)", "project:\($project)"],
      importance: $importance,
      type: $type,
      metadata: {
        test_framework: $test_framework,
        tests_passed: $tests_passed,
        tests_failed: $tests_failed,
        exit_code: $exit_code,
        command: $command,
        project: $project,
        error_details: $error_details
      },
      timestamp: $timestamp
    }'); then
    log_message "Failed to build test memory record"
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
log_message "Test pattern captured: $TESTS_PASSED passed, $TESTS_FAILED failed"

# Quick feedback
if [ "$TESTS_FAILED" -gt 0 ]; then
    echo "🧠 Test failures captured for learning"
else
    echo "✅ Test success pattern recorded"
fi

SCRIPT_SUCCESS=true
exit 0
