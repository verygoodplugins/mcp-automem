#!/bin/bash

# Cursor Session Stop Hook
# Triggered on stop - drains memory queue to AutoMem service
# Input: JSON via stdin with { "status": "completed|aborted|error" }
# Output: None (stop hooks don't return data)

# Configuration
QUEUE_FILE="$HOME/.cursor/memory-queue.jsonl"
LOG_FILE="$HOME/.cursor/logs/hooks.log"

# Ensure directories exist
mkdir -p "$(dirname "$QUEUE_FILE")" "$(dirname "$LOG_FILE")"

# Log function
log_message() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] [drain-queue] $1" >> "$LOG_FILE"
}

log_message "Session stop hook triggered"

# Read JSON input from stdin
INPUT=$(cat)
STATUS=$(echo "$INPUT" | jq -r '.status // "unknown"' 2>/dev/null || echo "unknown")

log_message "Session ended with status: $STATUS"

# Check if queue file exists and has content
if [ ! -f "$QUEUE_FILE" ]; then
    log_message "No queue file found, nothing to drain"
    exit 0
fi

# Check if file is empty
if [ ! -s "$QUEUE_FILE" ]; then
    log_message "Queue file is empty, nothing to drain"
    exit 0
fi

# Count entries
ENTRY_COUNT=$(wc -l < "$QUEUE_FILE" | tr -d ' ')
log_message "Draining $ENTRY_COUNT queued memories"
log_message "Queue contents:"

# Log each queued memory
while IFS= read -r line; do
    log_message "  → $line"
done < "$QUEUE_FILE"

# Run queue processor
log_message "Starting queue processor"

if command -v npx > /dev/null 2>&1; then
    # Run in background to avoid blocking
    (
        # Export AUTOMEM env vars from Cursor's MCP config if available
        if [ -f "$HOME/.cursor/mcp.json" ]; then
            AUTOMEM_ENDPOINT=$(jq -r '.mcpServers.memory.env.AUTOMEM_ENDPOINT // empty' "$HOME/.cursor/mcp.json" 2>/dev/null)
            AUTOMEM_API_KEY=$(jq -r '.mcpServers.memory.env.AUTOMEM_API_KEY // empty' "$HOME/.cursor/mcp.json" 2>/dev/null)
            
            if [ -n "$AUTOMEM_ENDPOINT" ]; then
                export AUTOMEM_ENDPOINT
                log_message "Using AUTOMEM_ENDPOINT from mcp.json: $AUTOMEM_ENDPOINT"
            fi
            
            if [ -n "$AUTOMEM_API_KEY" ]; then
                export AUTOMEM_API_KEY
                log_message "Using AUTOMEM_API_KEY from mcp.json"
            fi
        fi
        
        npx @verygoodplugins/mcp-automem queue --file "$QUEUE_FILE" >> "$LOG_FILE" 2>&1
        RESULT=$?
        
        if [ $RESULT -eq 0 ]; then
            log_message "Queue drained successfully ($ENTRY_COUNT entries)"
        else
            log_message "Queue drain failed with exit code $RESULT"
        fi
    ) &
    
    # Store PID
    echo $! > /tmp/cursor_memory_processor.pid
    log_message "Queue processor started in background (PID: $!)"
else
    log_message "ERROR: npx not found, cannot drain queue"
fi

# Quick user notification
if [ "$ENTRY_COUNT" -gt 0 ]; then
    echo "🧠 Processing $ENTRY_COUNT session memories..."
fi

exit 0

