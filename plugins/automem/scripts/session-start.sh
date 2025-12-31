#!/bin/bash
# AutoMem Session Start Hook
# Outputs a prompt for Claude to recall relevant memories at session start

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
