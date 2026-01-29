#!/bin/bash
# AutoMem Session Start Hook
# 1. Sets up node/npx in PATH for later hooks (via CLAUDE_ENV_FILE)
# 2. Outputs a prompt for Claude to recall relevant memories

# Set up node PATH for later hooks (Stop, PostToolUse, etc.)
if [ -n "$CLAUDE_ENV_FILE" ]; then
    # Try common node locations
    for NODE_PATH in \
        "$HOME/.nvm/versions/node/"*/bin \
        "$HOME/.volta/bin" \
        "$HOME/.fnm/aliases/default/bin" \
        "/usr/local/bin" \
        "/opt/homebrew/bin"
    do
        if [ -d "$NODE_PATH" ] 2>/dev/null; then
            echo "export PATH=\"$NODE_PATH:\$PATH\"" >> "$CLAUDE_ENV_FILE"
            break
        fi
    done
fi

cat << 'EOF'
<automem_session_context>
MEMORY RECALL: Before your first substantive response, call recall_memory:

mcp__memory__recall_memory({
  queries: ["project: ${PROJECT_NAME:-current}", "coding-style preferences", "user workflows"],
  limit: 15,
  time_query: "last 7 days"
})

Expand with anything relevant to the user's message (errors, files, topics).
If recall fails, continue without memory - don't mention the failure.
</automem_session_context>
EOF
