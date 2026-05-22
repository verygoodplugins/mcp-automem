#!/bin/bash

# AutoMem Session Start Hook for Copilot CLI
# Outputs JSON with additionalContext to inject memory recall prompt
# into the agent's context window at session start.
#
# Copilot CLI supports context injection via:
#   {"additionalContext": "..."} on stdout (since v1.0.11)

PROJECT=$(basename "$PWD")
AUTOMEM_HOOK_SURFACE="${AUTOMEM_HOOK_SURFACE:-copilot-cli}"

# Build the context prompt, substituting the project slug
read -r -d '' CONTEXT << PROMPT_END
<automem_session_context>
MEMORY RECALL - run these phases in order before your first substantive response.

Phase 1 - Preferences (tag-only, no time filter, no query):
  automem-recall_memory({
    tags: ["preference"],
    limit: 20,
    sort: "updated_desc",
    format: "detailed"
  })

Phase 2 - Task context (ONE semantic query from the user's actual nouns; project-slug gate when unambiguous; 90-day window):
  automem-recall_memory({
    query: "<proper nouns, product names, tools, specific topics from the user's message>",
    tags: ["$PROJECT"],
    time_query: "last 90 days",
    limit: 30,
    format: "detailed"
  })

Phase 3 - ON-DEMAND debugging (only if the user's message is a debugging/error-symptom question; skip otherwise):
  automem-recall_memory({
    query: "<error symptom>",
    tags: ["bugfix", "solution"],
    limit: 20
  })

Project slug: $PROJECT

Notes:
- Tags are a HARD GATE - they filter before scoring. For discovery/debugging across the full corpus, drop \`tags\` and rely on semantic \`query\` alone.
- Do NOT use namespace-prefixed tags (\`project/*\`, \`lang/*\`, etc.) - the corpus uses bare tags.
- Phase 2 uses ONE targeted query, not \`queries[]\` + \`auto_decompose\`. Sub-queries converge and dedup drops results; a single query built from the real nouns in the user's message wins empirically. Only switch to \`queries[]\` for genuinely multi-topic questions.
- If the project slug collides with a common topic word, drop the Phase 2 tag gate and rely on semantic \`query\` alone.
- Do not re-recall every turn. After turn 1, recall again only for topic shifts, new proper nouns, or active debugging.
- If recall fails or returns nothing, continue without memory - do not mention the failure to the user.
- Do not make your first tool call for the user's task until both recall phases are processed.
</automem_session_context>
PROMPT_END

# Output JSON with additionalContext for Copilot CLI context injection
# Use jq if available for safe escaping, fall back to python, then manual
if command -v jq >/dev/null 2>&1; then
    if [ "$AUTOMEM_HOOK_SURFACE" = "vscode-copilot" ]; then
        printf '%s' "$CONTEXT" | jq -Rs '{hookSpecificOutput: {hookEventName: "SessionStart", additionalContext: .}}'
    else
        printf '%s' "$CONTEXT" | jq -Rs '{additionalContext: .}'
    fi
elif command -v python3 >/dev/null 2>&1; then
    printf '%s' "$CONTEXT" | AUTOMEM_HOOK_SURFACE="$AUTOMEM_HOOK_SURFACE" python3 -c 'import os,sys,json; ctx=sys.stdin.read(); print(json.dumps({"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":ctx}} if os.environ.get("AUTOMEM_HOOK_SURFACE") == "vscode-copilot" else {"additionalContext":ctx}))'
elif command -v python >/dev/null 2>&1; then
    printf '%s' "$CONTEXT" | AUTOMEM_HOOK_SURFACE="$AUTOMEM_HOOK_SURFACE" python -c 'import os,sys,json; ctx=sys.stdin.read(); print(json.dumps({"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":ctx}} if os.environ.get("AUTOMEM_HOOK_SURFACE") == "vscode-copilot" else {"additionalContext":ctx}))'
else
    # Manual escape as last resort
    ESCAPED=$(printf '%s' "$CONTEXT" | sed 's/\\/\\\\/g; s/"/\\"/g' | awk '{printf "%s\\n", $0}' | sed 's/\\n$//')
    if [ "$AUTOMEM_HOOK_SURFACE" = "vscode-copilot" ]; then
        printf '{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"%s"}}\n' "$ESCAPED"
    else
        printf '{"additionalContext":"%s"}\n' "$ESCAPED"
    fi
fi
