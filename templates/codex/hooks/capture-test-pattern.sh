#!/bin/bash

# Sanitized Capture Test Pattern Hook for AutoMem with explicit storage fields.

HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CODEX_HOME="${CODEX_HOME:-$HOME/.codex}"
RELATIVE_PYTHON_HELPER="$(cd "$HOOK_DIR/../scripts" 2>/dev/null && pwd)/python-command.sh"
PYTHON_HELPER="$CODEX_HOME/scripts/python-command.sh"
LOG_FILE="$CODEX_HOME/logs/test-patterns.log"
MEMORY_QUEUE="$CODEX_HOME/scripts/memory-queue.jsonl"

if [ -f "$RELATIVE_PYTHON_HELPER" ]; then
    PYTHON_HELPER="$RELATIVE_PYTHON_HELPER"
fi

if [ -f "$PYTHON_HELPER" ]; then
    # shellcheck disable=SC1090
    . "$PYTHON_HELPER"
else
    echo "Warning: python resolver not found - capture disabled" >&2
    exit 0
fi

mkdir -p "$(dirname "$LOG_FILE")"
mkdir -p "$(dirname "$MEMORY_QUEUE")"

log_message() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" >> "$LOG_FILE"
}

if ! command -v jq >/dev/null 2>&1; then
    echo "Warning: jq not installed - capture disabled" >&2
    exit 0
fi

if ! automem_resolve_python >/dev/null 2>&1; then
    echo "Warning: Python not installed (tried python3, python, py -3) - capture disabled" >&2
    exit 0
fi

INPUT_JSON=$(cat)

COMMAND=$(echo "$INPUT_JSON" | jq -r '.tool_input.command // empty' 2>/dev/null)
COMMAND="${COMMAND:-${CODEX_LAST_COMMAND:-${CLAUDE_LAST_COMMAND:-${CLAUDE_CONTEXT:-${TOOL_NAME:-}}}}}"
OUTPUT=$(echo "$INPUT_JSON" | jq -r '.tool_response | if type == "object" then [(.stdout // ""), (.stderr // "")] | map(select(. != "")) | join("\n") else (. // "") end' 2>/dev/null)
OUTPUT="${OUTPUT:-${CODEX_COMMAND_OUTPUT:-${CLAUDE_COMMAND_OUTPUT:-${TOOL_RESULT:-}}}}"
EXIT_CODE=$(echo "$INPUT_JSON" | jq -r '.tool_response | if type == "object" then (.exit_code // .exitCode // 0) else 0 end' 2>/dev/null)
EXIT_CODE="${EXIT_CODE:-${CODEX_EXIT_CODE:-${CLAUDE_EXIT_CODE:-0}}}"
CWD=$(echo "$INPUT_JSON" | jq -r '.cwd // empty' 2>/dev/null)
SESSION_ID=$(echo "$INPUT_JSON" | jq -r '.session_id // .sessionId // empty' 2>/dev/null)
SESSION_ID="${SESSION_ID:-${CODEX_SESSION_ID:-${CLAUDE_SESSION_ID:-}}}"
PROJECT_NAME=$(basename "${CWD:-$(pwd)}")

if [ -z "$COMMAND" ] || ! echo "$COMMAND" | grep -qiE "(^|\\s)(npm test|yarn test|pnpm test|vitest|jest|pytest|python .*test|go test|cargo test|phpunit)"; then
    exit 0
fi

TESTS_PASSED=0
TESTS_FAILED=0
TEST_FRAMEWORK="unknown"

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
    TESTS_PASSED=$(echo "$OUTPUT" | grep -oE "OK \([0-9]+ test" | grep -oE "[0-9]+" | head -1)
    TESTS_PASSED="${TESTS_PASSED:-0}"
    TESTS_FAILED=$(echo "$OUTPUT" | grep -oE "FAILURES.*Tests: [0-9]+" | grep -oE "[0-9]+" | tail -1)
    TESTS_FAILED="${TESTS_FAILED:-0}"
fi

IMPORTANCE=0.5
MEMORY_CONFIDENCE=0.85
if [ "$TESTS_FAILED" -gt 0 ]; then
    IMPORTANCE=0.8
    MEMORY_TYPE="Insight"
    MEMORY_CONFIDENCE=0.90
elif [ "$TESTS_PASSED" -gt 10 ]; then
    IMPORTANCE=0.6
    MEMORY_TYPE="Pattern"
    MEMORY_CONFIDENCE=0.80
else
    MEMORY_TYPE="Context"
fi

ERROR_DETAILS=""
if [ "$TESTS_FAILED" -gt 0 ]; then
    ERROR_DETAILS=$(echo "$OUTPUT" | grep -A 2 -E "FAIL|ERROR|AssertionError" | head -20)
fi

if [ "$EXIT_CODE" -eq 0 ]; then
    CONTENT="Test suite passed: $TESTS_PASSED tests in $PROJECT_NAME using $TEST_FRAMEWORK. Command: $COMMAND"
else
    CONTENT="Test failures in $PROJECT_NAME: $TESTS_FAILED failed, $TESTS_PASSED passed using $TEST_FRAMEWORK. Errors: $ERROR_DETAILS"
fi

AUTOMEM_QUEUE="$MEMORY_QUEUE" \
AUTOMEM_CONTENT="$CONTENT" \
AUTOMEM_TEST_FRAMEWORK="$TEST_FRAMEWORK" \
AUTOMEM_PROJECT="$PROJECT_NAME" \
AUTOMEM_IMPORTANCE="$IMPORTANCE" \
AUTOMEM_TYPE="$MEMORY_TYPE" \
AUTOMEM_CONFIDENCE="$MEMORY_CONFIDENCE" \
AUTOMEM_TESTS_PASSED="$TESTS_PASSED" \
AUTOMEM_TESTS_FAILED="$TESTS_FAILED" \
AUTOMEM_EXIT_CODE="$EXIT_CODE" \
AUTOMEM_COMMAND="$COMMAND" \
AUTOMEM_ERROR_DETAILS="$ERROR_DETAILS" \
AUTOMEM_ORIGIN_SESSION_ID="$SESSION_ID" \
automem_run_python - <<'PY'
import hashlib
import json
import os
import re
from datetime import datetime, timezone

try:
    import fcntl
except ImportError:
    fcntl = None

try:
    import msvcrt
except ImportError:
    msvcrt = None

HEREDOC_RE = re.compile(r'git commit -m .*\$\(cat <<[\'"]?EOF[\'"]?.*?(?:\nEOF\n|\Z)', re.DOTALL)
LINE_NOISE_RE = re.compile(r"^\s*(cat <<'?EOF'?|EOF|\)\"?)\s*$")

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

def to_int(value, default=0):
    try:
        return int(value)
    except (TypeError, ValueError):
        return default

def sanitize(text, max_len=300):
    text = text or ""
    text = HEREDOC_RE.sub("[shell paste omitted]", text)
    lines = [line for line in text.splitlines() if not LINE_NOISE_RE.match(line)]
    text = " ".join(" ".join(lines).split())
    if len(text) > max_len:
        return text[: max_len - 3].rstrip() + "..."
    return text

def content_hash(text):
    return hashlib.md5(text.encode("utf-8")).hexdigest()

def is_duplicate(queue_path, new_content, lookback=20):
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
framework = os.environ.get("AUTOMEM_TEST_FRAMEWORK", "unknown")
tests_failed = to_int(os.environ.get("AUTOMEM_TESTS_FAILED", "0"))

FRAMEWORK_TO_LANG = {
    "pytest": "python",
    "jest/vitest": "typescript",
    "go": "go",
    "phpunit": "php",
}
lang = FRAMEWORK_TO_LANG.get(framework)

tags = ["test"]
if framework and framework != "unknown":
    tags.append(framework.replace("/", "-"))
if lang:
    tags.append(lang)
if project:
    tags.append(project)
if tests_failed > 0:
    tags.append("failure")

now_iso = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
metadata = {
    "test_framework": framework,
    "tests_passed": to_int(os.environ.get("AUTOMEM_TESTS_PASSED", "0")),
    "tests_failed": tests_failed,
    "exit_code": to_int(os.environ.get("AUTOMEM_EXIT_CODE", "0")),
    "command": sanitize(os.environ.get("AUTOMEM_COMMAND", ""), 500),
    "project": project,
    "error_details": sanitize(os.environ.get("AUTOMEM_ERROR_DETAILS", "")),
}
origin_session_id = os.environ.get("AUTOMEM_ORIGIN_SESSION_ID", "") or None
if origin_session_id:
    metadata["originSessionId"] = origin_session_id

record = {
    "content": sanitize(os.environ.get("AUTOMEM_CONTENT", "")),
    "tags": tags,
    "importance": float(os.environ.get("AUTOMEM_IMPORTANCE", "0.5")),
    "type": os.environ.get("AUTOMEM_TYPE", "Context"),
    "confidence": float(os.environ.get("AUTOMEM_CONFIDENCE", "0.85")),
    "metadata": metadata,
    "timestamp": now_iso,
    "t_valid": now_iso,
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

log_message "Test pattern captured: $TESTS_PASSED passed, $TESTS_FAILED failed"
exit 0
