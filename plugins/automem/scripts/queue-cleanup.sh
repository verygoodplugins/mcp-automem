#!/bin/bash

# Queue Cleanup Script for AutoMem
# Deduplicates and archives processed memories
set -o pipefail

QUEUE_FILE="$HOME/.claude/scripts/memory-queue.jsonl"
LOG_FILE="$HOME/.claude/logs/queue-cleanup.log"

# Ensure log directory exists
mkdir -p "$(dirname "$LOG_FILE")"

# Log function
log_message() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" >> "$LOG_FILE"
}

log_message "Queue cleanup started"

# Check if queue file exists and has content
if [ ! -f "$QUEUE_FILE" ] || [ ! -s "$QUEUE_FILE" ]; then
    log_message "Queue file empty or doesn't exist, nothing to clean"
    exit 0
fi

# Count original entries
ORIGINAL_COUNT=$(wc -l < "$QUEUE_FILE" | tr -d ' ')
log_message "Original queue size: $ORIGINAL_COUNT entries"

# If queue is empty or has 1 line, skip
if [ "$ORIGINAL_COUNT" -le 1 ]; then
    log_message "Queue too small to deduplicate"
    exit 0
fi

# Create temporary deduped file using jq
TEMP_FILE="/tmp/memory-queue.dedup.$$.jsonl"

# Deduplicate by content field (keeps first occurrence)
jq -s 'unique_by(.content)' "$QUEUE_FILE" | jq -c '.[]' > "$TEMP_FILE" 2>/dev/null
PIPE_STATUS=("${PIPESTATUS[@]}")

# Check if deduplication succeeded
if [ "${PIPE_STATUS[0]}" -eq 0 ] && [ "${PIPE_STATUS[1]}" -eq 0 ] && [ -s "$TEMP_FILE" ]; then
    # Count deduped entries
    DEDUPED_COUNT=$(wc -l < "$TEMP_FILE" | tr -d ' ')
    REMOVED_COUNT=$((ORIGINAL_COUNT - DEDUPED_COUNT))

    log_message "Deduplication complete: removed $REMOVED_COUNT duplicates"
    log_message "New queue size: $DEDUPED_COUNT entries"

    # Archive original if we removed duplicates
    if [ "$REMOVED_COUNT" -gt 0 ]; then
        ARCHIVE_FILE="$HOME/.claude/scripts/memory-queue.$(date +%Y%m%d_%H%M%S).deduped.jsonl"
        cp "$QUEUE_FILE" "$ARCHIVE_FILE"
        log_message "Original archived to: $ARCHIVE_FILE"

        # Replace queue with deduped version
        mv "$TEMP_FILE" "$QUEUE_FILE"
        log_message "Queue replaced with deduplicated version"
    else
        rm -f "$TEMP_FILE"
        log_message "No duplicates found, original queue unchanged"
    fi
else
    log_message "Deduplication failed, keeping original queue"
    rm -f "$TEMP_FILE"
    exit 1
fi

# If queue is very large (>50 entries), archive and truncate to last 20
CURRENT_COUNT=$(wc -l < "$QUEUE_FILE" | tr -d ' ')
if [ "$CURRENT_COUNT" -gt 50 ]; then
    ARCHIVE_FILE="$HOME/.claude/scripts/memory-queue.$(date +%Y%m%d_%H%M%S).overflow.jsonl"
    cp "$QUEUE_FILE" "$ARCHIVE_FILE"

    # Keep only last 20 entries
    tail -20 "$QUEUE_FILE" > "/tmp/memory-queue.truncated.$$.jsonl"
    mv "/tmp/memory-queue.truncated.$$.jsonl" "$QUEUE_FILE"

    NEW_COUNT=$(wc -l < "$QUEUE_FILE" | tr -d ' ')
    log_message "Queue overflow: archived $CURRENT_COUNT entries, kept last $NEW_COUNT"
fi

log_message "Queue cleanup complete"
exit 0
