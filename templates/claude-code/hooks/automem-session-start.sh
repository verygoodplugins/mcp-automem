#!/bin/bash
# AutoMem SessionStart hook for Claude Code
# Prompts memory recall at the start of each session

PROJECT=$(basename "$PWD")

cat << EOF
<automem_session_context>
MEMORY RECALL: Before your first substantive response, call recall_memory:

mcp__memory__recall_memory({
  queries: ["project: $PROJECT", "coding-style preferences", "user workflows"],
  limit: 15,
  time_query: "last 7 days"
})

Expand with anything relevant to the user's message (errors, files, topics).
If recall fails, continue without memory - don't mention the failure.
</automem_session_context>
EOF
