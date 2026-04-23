<!-- BEGIN AUTOMEM CODEX RULES -->
<!-- automem-template-version: 0.13.0 -->

## Memory — AutoMem (persistent context for {{PROJECT_NAME}})

AutoMem is wired as the `memory` MCP server (see `~/.codex/config.toml`). Tools are `mcp__memory__*`. Use this layer *proactively* — it's what gives future turns continuity with past ones.

### Tool's real behavior (validated against production corpus)

- **Tags are a hard gate** — memories without a matching tag are excluded before scoring. Useful for stable categories (`preference`, `bugfix`); harmful when guessing a project slug.
- **One good query beats `queries[]` + `auto_decompose`** for focused tasks — sub-queries converge on the same top scorers, dedup strips them. Only use multi-query for genuinely multi-topic questions.
- **`limit` caps at 50.** Anything under 15 wastes context budget you have.
- **`format: "detailed"`** surfaces timestamps / confidence / importance / relations inline so you can judge staleness at a glance.
- **`store_memory` can silently fail** (returns success, doesn't persist). After storing anything that matters, recall a distinctive phrase to verify; retry once if gone.
- **Bare tag convention** — `automem`, not `project/automem`. No `lang/` prefix, no platform tag (`codex`), no `[YYYY-MM]` date tag (AutoMem has first-class `timestamp` / `t_valid` / `t_invalid`). `entity:*:*` tags are server-injected; don't author those.

### Slug-collision rule

Don't gate on `{{PROJECT_NAME}}` if it collides with common topic words (`video`, `test`, `api`). Use a more specific slug at store time, or drop the gate and rely on semantic query alone.

### Session start — two-phase recall

Standardized defaults across every AutoMem template (Phase 1 `limit 20`, Phase 2 `limit 30`, 90-day window).

```javascript
mcp__memory__recall_memory({
  tags: ["preference"],
  limit: 20,
  sort: "updated_desc",
  format: "detailed"
});

mcp__memory__recall_memory({
  query: "<proper nouns, file/module names, error strings, tools, specific topics from the user's message>",
  tags: ["{{PROJECT_NAME}}"],          // drop if slug collides with a common word
  language: "<typescript|python|go|rust|...>",
  time_query: "last 90 days",
  limit: 30,
  format: "detailed"
});
```

Skip Phase 2 entirely for pure syntax questions, trivial edits, or direct factual queries about current code. Don't re-recall mid-conversation unless the topic genuinely shifts, an unfamiliar proper noun enters, or you need to verify a specific technical claim — with 1M context, turn-1 memories are still in scope on turn 15.

For active-debugging turns only, add a targeted bugfix recall:

```javascript
mcp__memory__recall_memory({
  query: "<error symptom, stack trace keywords>",
  tags: ["bugfix", "solution"],
  limit: 20
});
```

### Storage

```javascript
mcp__memory__store_memory({
  content: "Brief title. Context + reasoning. Outcome.",   // 150–300 chars
  type: "Decision",   // Decision | Pattern | Preference | Style | Habit | Insight | Context
  tags: ["<category>", "{{PROJECT_NAME}}", "<language>"],  // bare; NO platform, NO [YYYY-MM]
  importance: 0.85,   // 0.9+ critical, 0.7–0.85 important, 0.5–0.6 standard
  confidence: 0.9     // 0.95 user-stated, 0.80 observed, 0.60 tentative
});
```

`importance` = how much this matters. `confidence` = how sure you are it's stable. Don't default everything to 0.95 — it flattens the signal decay uses to identify noise.

Soft limit 500 chars (auto-summarized), hard limit 2000 (rejected). Put structured data (file paths, metrics, exit codes) in `metadata`, not `content`. Cross-project preferences use `tags: ["personal", "<category>"]` instead of a project slug.

For facts with a shelf life, use `t_valid` / `t_invalid`:

```javascript
mcp__memory__store_memory({
  content: "{{PROJECT_NAME}} deployed to Railway at https://<url>",
  type: "Context", importance: 0.8, confidence: 0.9,
  tags: ["deployment", "{{PROJECT_NAME}}", "railway"],
  t_valid: "<ISO now>",
  t_invalid: "<ISO when this stops being true>"
});
```

### Three mid-conversation triggers (and only three)

1. **User correction or override** ("actually…", "no, I prefer…", "stop doing X", "we decided X already") → `Preference`, importance 0.9, confidence 0.95, tag `correction`. Associate `INVALIDATED_BY` the prior memory.
2. **Stabilized decision — the decision stabilizes after surviving at least one round of discussion** ("let's go with X", "ship it", "yeah that's the plan") → `Decision`, importance 0.85–0.9. Associate `PREFERS_OVER` alternatives considered.
3. **Pattern explicitly articulated** ("I always do X", "every time", "my thing is") → `Pattern`, importance 0.8. Associate `EXEMPLIFIES` concrete examples.

For each trigger, run the atomic ritual *this turn* — don't queue for later.

### The atomic ritual — every store runs all four steps

```javascript
// Step 1: Recall to find what this relates to
const related = await mcp__memory__recall_memory({
  query: "<what's being corrected / decided / named>",
  limit: 5
});

// Step 2: Store with type, importance, tags, non-default confidence
const newId = await mcp__memory__store_memory({
  content: "Brief title. Context + reasoning. Outcome.",
  type: "Preference",
  tags: ["correction", "{{PROJECT_NAME}}"],
  importance: 0.9,
  confidence: 0.95
});

// Step 3: Verify the store landed (silent-fail insurance)
await mcp__memory__recall_memory({
  query: "<distinctive phrase from the new content>",
  limit: 3
});
// If not in results, retry the store once.

// Step 4: Link to step 1's result if plausible
if (related?.results?.length) {
  await mcp__memory__associate_memories({
    memory1_id: related.results[0].id,
    memory2_id: newId,
    type: "INVALIDATED_BY",   // or PREFERS_OVER / EXEMPLIFIES / LEADS_TO
    strength: 0.9
  });
}
```

Step 4 is where the graph actually gets built. Skipping it is the #1 reason AutoMem degrades into a flat bag of notes.

### Mandatory association pairings

| Trigger | Store as | Then associate |
|---|---|---|
| User correction | `Preference`, 0.9 / 0.95 | Old memory → `INVALIDATED_BY` |
| Architectural decision | `Decision`, 0.9 / 0.9 | Alternatives → `PREFERS_OVER` |
| Bug fix | `Insight`, 0.75 / 0.85 (tags: `bugfix`+`solution`) | Bug-report memory → `LEADS_TO` |
| Pattern discovered | `Pattern`, 0.8 | Concrete examples → `EXEMPLIFIES` |
| Knowledge evolved | `update_memory` old + store new | `EVOLVED_INTO` (old → new) |
| Deprecated info | `update_memory` (importance 0.1, `metadata.deprecated: true`) | `INVALIDATED_BY` (old ← new) |

Skip the association only if step 1 returns nothing plausible.

### Update > duplicate

When a fact changes in place (URL, version, price, deployment state), use `update_memory` on the existing memory. Reserve new-store + `INVALIDATED_BY` for archaeology worth preserving (e.g., "considered $15/mo before landing on $9/mo"). Recall first before storing on any topic — prefer `update_memory` or an association over a near-duplicate.

### What NOT to store mid-conversation

- **Session summaries.** Ever. They're the #1 source of corpus garbage.
- **Agent task-result dumps.** Same family.
- **"Useful context that might matter later."** Speculative stores are noise.
- **Confirmations.** "That worked" doesn't need a memory; the decision that preceded it might.
- **Things the user will remember themselves** — calendar, plans, casual opinions.
- **Anything stored to perform attentiveness.** Memory is for future-you, not for showing the user you were listening this turn.

### Valid relation types

Authorable: `RELATES_TO`, `LEADS_TO`, `OCCURRED_BEFORE`, `PREFERS_OVER`, `EXEMPLIFIES`, `CONTRADICTS`, `REINFORCES`, `INVALIDATED_BY`, `EVOLVED_INTO`, `DERIVED_FROM`, `PART_OF`. System-injected (`SIMILAR_TO`, `PRECEDED_BY`, `DISCOVERED`, `SHARES_THEME`, `PARALLEL_CONTEXT`, `EXPLAINS`) appear in recall results but are not valid inputs.

### Advanced recall — caveats

`expand_entities` and `expand_relations` are no-ops on the current sparse-association corpus per the validated playbook (revisit after association authoring discipline is established). When you do reach for them, drop the tag gate first — the server re-applies tag filters to expansion targets, which defeats the traversal.

### Guidelines

- Weave recalled context naturally; don't announce memory operations.
- Prefer high-signal memories (decisions, root causes, reusable patterns).
- Never store secrets, credentials, tokens, or PII.
- Avoid wall-of-text memories; keep them atomic and focused.
- If recall fails or returns nothing, continue without memory — don't surface the failure.

<!-- END AUTOMEM CODEX RULES -->
