#!/bin/bash
# AutoMem SessionStart hook — prompts Claude to run two-phase recall.
# Claude executes the MCP tool calls; this script just injects the prompt.
# Validated against the production corpus (issue #97 §D): bare tags, 1M-context limits.

PROJECT=$(basename "$PWD")

cat << EOF
<automem_session_context>
MEMORY RECALL — run these phases in order before your first substantive response.

Phase 1 — Preferences (tag-only, no time filter, no query):
  mcp__memory__recall_memory({ tags: ["preference"], limit: 20 })

Phase 2 — Task context (semantic + project-gated + 90-day window):
  mcp__memory__recall_memory({
    queries: ["<what the user is asking>", "user corrections", "recent decisions"],
    tags: ["$PROJECT"],
    auto_decompose: true,
    time_query: "last 90 days",
    limit: 30
  })

Phase 3 — ON-DEMAND (only if the user's message is a debugging/error-symptom question; skip otherwise):
  mcp__memory__recall_memory({
    query: "<error symptom>",
    tags: ["bugfix", "solution"],
    limit: 20
  })

Project slug: $PROJECT

Notes:
- Tags are a HARD GATE — they filter before scoring. For discovery/debugging across the full corpus, drop \`tags\` and rely on semantic \`query\` alone.
- Do NOT use namespace-prefixed tags (\`project/*\`, \`lang/*\`, etc.) — the corpus uses bare tags.
- If recall fails or returns nothing, continue without memory — do not mention the failure to the user.
</automem_session_context>
EOF
