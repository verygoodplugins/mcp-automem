#!/bin/bash
# AutoMem Session Start Hook
# 1. Sets up node/npx in PATH for later hooks (via CLAUDE_ENV_FILE)
# 2. Outputs a prompt for Claude to recall relevant memories

# Output Success on clean exit for consistent hook feedback
trap 'echo "Success"' EXIT

# Set up node PATH for later hooks (Stop, PostToolUse, etc.)
if [ -n "$CLAUDE_ENV_FILE" ]; then
    # Try common node locations - verify node/npx actually exists
    # For nvm: prefer default alias, then current, then latest installed
    NVM_DEFAULT=""
    if [ -d "$HOME/.nvm/versions/node" ]; then
        # Try default alias file first (nvm stores aliases as plain text files)
        if [ -f "$HOME/.nvm/alias/default" ]; then
            NVM_ALIAS=$(cat "$HOME/.nvm/alias/default" 2>/dev/null | tr -d '[:space:]')
            if [ -n "$NVM_ALIAS" ]; then
                NVM_DEFAULT=$(ls -d "$HOME/.nvm/versions/node/v${NVM_ALIAS}"*/bin 2>/dev/null | sort -t'v' -k2 -V -r | head -1)
            fi
        fi
        # Fall back to latest installed version (reverse sort = highest version first)
        if [ -z "$NVM_DEFAULT" ] || [ ! -d "$NVM_DEFAULT" ]; then
            NVM_DEFAULT=$(ls -d "$HOME/.nvm/versions/node/"*/bin 2>/dev/null | sort -t'v' -k2 -V -r | head -1)
        fi
    fi

    for NODE_PATH in \
        ${NVM_DEFAULT:+"$NVM_DEFAULT"} \
        "$HOME/.volta/bin" \
        "$HOME/.fnm/aliases/default/bin" \
        "/usr/local/bin" \
        "/opt/homebrew/bin"
    do
        if [ -x "$NODE_PATH/node" ] || [ -x "$NODE_PATH/npx" ]; then
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
