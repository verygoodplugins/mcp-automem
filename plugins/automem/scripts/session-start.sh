#!/bin/bash
# AutoMem SessionStart hook — prompts Claude to run two-phase recall.
# Claude executes the MCP tool calls; this script just injects the prompt.
# Validated against the production corpus (issue #97 §D): bare tags,
# 1M-context limits, single-query Phase 2 (drops queries[] + auto_decompose
# because sub-queries converge on the same top scorers and dedup strips them).

PROJECT=$(basename "$PWD")

cat << EOF
<automem_session_context>
MEMORY RECALL — run these phases in order before your first substantive response.

Phase 1 — Preferences (tag-only, no time filter, no query):
  mcp__memory__recall_memory({
    tags: ["preference"],
    limit: 20,
    sort: "updated_desc",
    format: "detailed"
  })

Phase 2 — Task context (ONE semantic query from the user's actual nouns; project-slug gate; 90-day window):
  mcp__memory__recall_memory({
    query: "<proper nouns, product names, tools, specific topics from the user's message>",
    tags: ["$PROJECT"],
    time_query: "last 90 days",
    limit: 30,
    format: "detailed"
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
- Phase 2 uses ONE targeted query, not \`queries[]\` + \`auto_decompose\`. Sub-queries converge and dedup drops results; a single query built from the real nouns in the user's message wins empirically. Only switch to \`queries[]\` for genuinely multi-topic questions.
- If the project slug collides with a common topic word (e.g., \`video\`, \`test\`), drop the Phase 2 tag gate and rely on semantic \`query\` alone.
- If recall fails or returns nothing, continue without memory — do not mention the failure to the user.
</automem_session_context>
EOF
