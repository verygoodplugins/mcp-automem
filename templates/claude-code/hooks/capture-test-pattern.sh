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
COMMAND="${CLAUDE_LAST_COMMAND:-test}"
OUTPUT="${CLAUDE_COMMAND_OUTPUT:-}"
EXIT_CODE="${CLAUDE_EXIT_CODE:-0}"
PROJECT_NAME=$(basename "$(pwd)")

# Analyze test results
TESTS_PASSED=0
TESTS_FAILED=0
TEST_FRAMEWORK="unknown"

# Detect test framework and parse results
if echo "$COMMAND" | grep -q "pytest\|python.*test"; then
    TEST_FRAMEWORK="pytest"
    TESTS_PASSED=$(echo "$OUTPUT" | grep -oE "[0-9]+ passed" | grep -oE "[0-9]+" | head -1 || echo 0)
    TESTS_FAILED=$(echo "$OUTPUT" | grep -oE "[0-9]+ failed" | grep -oE "[0-9]+" | head -1 || echo 0)
elif echo "$COMMAND" | grep -q "npm test\|jest\|vitest"; then
    TEST_FRAMEWORK="jest/vitest"
    TESTS_PASSED=$(echo "$OUTPUT" | grep -oE "Tests:.*[0-9]+ passed" | grep -oE "[0-9]+ passed" | grep -oE "[0-9]+" || echo 0)
    TESTS_FAILED=$(echo "$OUTPUT" | grep -oE "Tests:.*[0-9]+ failed" | grep -oE "[0-9]+ failed" | grep -oE "[0-9]+" || echo 0)
elif echo "$COMMAND" | grep -q "go test"; then
    TEST_FRAMEWORK="go"
    TESTS_PASSED=$(echo "$OUTPUT" | grep -c "PASS" || echo 0)
    TESTS_FAILED=$(echo "$OUTPUT" | grep -c "FAIL" || echo 0)
elif echo "$COMMAND" | grep -q "phpunit"; then
    TEST_FRAMEWORK="phpunit"
    # Parse PHPUnit output
    TESTS_PASSED=$(echo "$OUTPUT" | grep -oE "OK \([0-9]+ test" | grep -oE "[0-9]+" || echo 0)
    TESTS_FAILED=$(echo "$OUTPUT" | grep -oE "FAILURES.*Tests: [0-9]+" | grep -oE "[0-9]+" | tail -1 || echo 0)
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
    ERROR_DETAILS=$(echo "$OUTPUT" | grep -A 2 -E "FAIL|ERROR|AssertionError" | head -20 | tr '\n' ' ' | sed 's/"/\\"/g')
fi

# Create memory content
if [ "$EXIT_CODE" -eq 0 ]; then
    CONTENT="Test suite passed: $TESTS_PASSED tests in $PROJECT_NAME using $TEST_FRAMEWORK. Command: $COMMAND"
else
    CONTENT="Test failures in $PROJECT_NAME: $TESTS_FAILED failed, $TESTS_PASSED passed using $TEST_FRAMEWORK. Errors: ${ERROR_DETAILS:0:200}"
fi

# Create memory record
MEMORY_RECORD=$(cat <<EOF
{
  "content": "$CONTENT",
  "tags": ["test", "$TEST_FRAMEWORK", "$PROJECT_NAME", "$(date +%Y-%m)"],
  "importance": $IMPORTANCE,
  "type": "$MEMORY_TYPE",
  "metadata": {
    "test_framework": "$TEST_FRAMEWORK",
    "tests_passed": $TESTS_PASSED,
    "tests_failed": $TESTS_FAILED,
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
log_message "Test pattern captured: $TESTS_PASSED passed, $TESTS_FAILED failed"

# Quick feedback
if [ "$TESTS_FAILED" -gt 0 ]; then
    echo "🧠 Test failures captured for learning"
else
    echo "✅ Test success pattern recorded"
fi

exit 0