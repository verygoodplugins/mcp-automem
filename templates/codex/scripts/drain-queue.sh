#!/bin/bash

# Codex Stop hook: deduplicate and drain the AutoMem queue sequentially.
# Stop hooks must emit JSON on stdout when they exit 0, so all command output
# from cleanup/drain work is redirected to a log file.

if [ -z "${BASH_VERSION:-}" ]; then
    exec /bin/bash "$0" "$@"
fi

set -o pipefail

CODEX_HOME="${CODEX_HOME:-$HOME/.codex}"
QUEUE_FILE="$CODEX_HOME/scripts/memory-queue.jsonl"
LOG_FILE="$CODEX_HOME/logs/drain-queue.log"
CLEANUP_SCRIPT="$CODEX_HOME/scripts/queue-cleanup.sh"

mkdir -p "$(dirname "$LOG_FILE")" "$(dirname "$QUEUE_FILE")"

log_message() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" >> "$LOG_FILE"
}

log_message "Codex AutoMem queue drain triggered"

if [ -x "$CLEANUP_SCRIPT" ]; then
    CODEX_HOME="$CODEX_HOME" bash "$CLEANUP_SCRIPT" >> "$LOG_FILE" 2>&1
    cleanup_status=$?
    log_message "queue cleanup exited with status $cleanup_status"
else
    log_message "queue cleanup script not found or not executable: $CLEANUP_SCRIPT"
fi

if [ -s "$QUEUE_FILE" ]; then
    CODEX_HOME="$CODEX_HOME" npx -y @verygoodplugins/mcp-automem queue \
        --file "$QUEUE_FILE" \
        --limit 5 >> "$LOG_FILE" 2>&1
    drain_status=$?
    log_message "queue command exited with status $drain_status"
else
    log_message "queue is empty; nothing to drain"
fi

printf '{"continue":true}\n'
exit 0
