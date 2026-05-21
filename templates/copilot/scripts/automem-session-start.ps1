# automem-session-start.ps1 - Inject memory recall prompt at session start
# AutoMem hook for Copilot - outputs JSON with additionalContext
# Copilot CLI supports context injection via:
#   {"additionalContext": "..."} on stdout (since v1.0.11)
try {
    $project = Split-Path (Get-Location).Path -Leaf

    $context = @"
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
    tags: ["$project"],
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

Project slug: $project

Notes:
- Tags are a HARD GATE - they filter before scoring. For discovery/debugging across the full corpus, drop ``tags`` and rely on semantic ``query`` alone.
- Do NOT use namespace-prefixed tags (``project/*``, ``lang/*``, etc.) - the corpus uses bare tags.
- Phase 2 uses ONE targeted query, not ``queries[]`` + ``auto_decompose``. Sub-queries converge and dedup drops results; a single query built from the real nouns in the user's message wins empirically.
- If the project slug collides with a common topic word, drop the Phase 2 tag gate and rely on semantic ``query`` alone.
- Do not re-recall every turn. After turn 1, recall again only for topic shifts, new proper nouns, or active debugging.
- If recall fails or returns nothing, continue without memory - do not mention the failure to the user.
- Do not make your first tool call for the user's task until both recall phases are processed.
</automem_session_context>
"@

    # Output JSON with additionalContext for Copilot CLI context injection
    $result = @{ additionalContext = $context } | ConvertTo-Json -Compress
    Write-Output $result
} catch {
    # Fail silently - do not block session start
    exit 0
}
