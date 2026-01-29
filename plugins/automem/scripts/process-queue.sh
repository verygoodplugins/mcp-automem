#!/bin/bash

# Process memory queue with proper environment
# This wrapper ensures npx is available even in restricted hook environments

# Source user's shell profile for PATH
if [ -f "$HOME/.zshrc" ]; then
    source "$HOME/.zshrc" 2>/dev/null
elif [ -f "$HOME/.bashrc" ]; then
    source "$HOME/.bashrc" 2>/dev/null
fi

# Also check common node locations
for NODE_PATH in \
    "$HOME/.nvm/versions/node/"*/bin \
    "$HOME/.volta/bin" \
    "/usr/local/bin" \
    "/opt/homebrew/bin"
do
    if [ -d "$NODE_PATH" ]; then
        export PATH="$NODE_PATH:$PATH"
    fi
done

QUEUE_FILE="${HOME}/.claude/scripts/memory-queue.jsonl"

# Skip if queue doesn't exist or is empty
if [ ! -s "$QUEUE_FILE" ]; then
    exit 0
fi

# Process queue
if command -v npx &>/dev/null; then
    npx -y @verygoodplugins/mcp-automem queue --file "$QUEUE_FILE" --limit 5
else
    echo "Warning: npx not found, queue will be processed next session" >&2
fi
