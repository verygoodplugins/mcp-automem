<!-- automem-template-version: 0.14.0 -->

# Cursor Rule Eval Set

Use this lightweight eval set whenever revising the Cursor memory rules. Verifies layered loading behavior, the validated two-phase recall, the three-triggers framework, the atomic ritual, mandatory associations, and the GPT-5.4 overlay.

> **Deprecated patterns.** The current playbook has retired several patterns reviewers may still expect from older rule revisions: `auto_decompose: true` for focused tasks, platform tags (`cursor`, `codex`), date-stamped tags (`[YYYY-MM]`), `confidence: 0.95` defaulted everywhere, `limit: 5` in routine recalls, `time_query: "last 30 days"` or `"last 60 days"`. If a scenario can satisfy itself with one of those, it's testing the wrong rule.

## Layering Scenarios

### A. Global only

**Setup:** Load only Cursor User Rules from `templates/cursor/user-rules.md`.

**Expected behavior:**
- Cross-project preference/style recall works without project tags.
- The prompt stays thin and does not introduce storage, association, tagging, or GPT-5.4 workflow policy.
- "Corrections are gold" guidance is present so global preference recall picks up corrections stored from any project.

### B. Project only

**Setup:** Load only `.cursor/rules/automem.mdc`.

**Expected behavior:**
- Two-phase session-start recall (preferences `limit 20`, task-context `limit 30`, `time_query: "last 90 days"`, `format: "detailed"`) runs on first substantive turn.
- Three-triggers framework + atomic ritual available for mid-conversation stores.
- GPT-5.4 overlay remains available in the project rule.

### C. Global + project

**Setup:** Load both Cursor User Rules and `.cursor/rules/automem.mdc`.

**Expected behavior:**
- Global rules handle cross-project style/autonomy/preferences defaults.
- Project rules handle the operational two-phase recall, triggers, and ritual.
- The two layers do not duplicate or contradict each other.

### D. Global + project + custom mode

**Setup:** Load Cursor User Rules, `.cursor/rules/automem.mdc`, and a task-specific Custom Mode.

**Expected behavior:**
- The Custom Mode adds task shape only.
- Memory policy still comes from the global + project layers.
- The mode prompt does not restate recall/store/update/associate behavior.

## Behavior Scenarios

### 1. Trivial typo fix

**Prompt:** `Fix the typo in README.md where "authenication" is misspelled.`

**Expected behavior:**
- Skip Phase 2 recall entirely (rule says skip for trivial edits / file-content requests).
- Inspect the file directly.
- Do not store a memory unless a broader durable insight emerges.

### 2. Architecture why-question

**Prompt:** `Why does this project use Redis for auth session caching instead of in-memory storage?`

**Expected behavior:**
- Run Phase 2 with `format: "detailed"` and `time_query: "last 90 days"`, `limit: 30` (NOT `limit: 5`).
- Query is built from the actual nouns in the message (e.g., `"Redis auth session caching in-memory"`), not generic phrases like `"current task"`.
- Use recalled context as supporting evidence, but confirm against the repo. If memory and current code disagree, trust current evidence.

### 3. Debugging task with durable fix

**Prompt:** `Login is timing out on slow networks after the last deploy. Find the cause and fix it.`

**Expected behavior:**
- Phase 3 on-demand recall (`tags: ["bugfix", "solution"]`) once the error is identified.
- After a real root cause is found, run the **atomic ritual**: recall (`limit 5`) → store as `Insight` (importance 0.75, confidence 0.85, tags include `bugfix` + `solution` + project slug) → verify-recall on a distinctive phrase → associate `LEADS_TO` the bug-discovery memory.
- The store has bare tags — no `cursor`, no `[YYYY-MM]`.

### 4. Preference update or supersession

**Prompt:** `We no longer use Prettier with single quotes. Update the coding-style preference to double quotes.`

**Expected behavior:**
- Recall the existing preference if present.
- **Prefer `update_memory`** over store + `INVALIDATED_BY` for an in-place style change. Reserve the new-store-plus-invalidate pattern for archaeology worth preserving.
- If a new memory is created instead, it must associate `INVALIDATED_BY` (strength 0.9) the prior preference.

### 5. Empty recall fallback

**Prompt:** `OAuth callbacks started failing after yesterday's deploy. Have we seen anything like this before?`

**Expected behavior:**
- Run a focused recall first (Phase 3 with bug-fix tags).
- If results are empty or thin, retry with **semantic-only** (drop the tag gate) before concluding nothing useful exists — tags are a hard gate; sparse historical content may live without the expected tags.
- Continue with repo / log inspection even if memory is unhelpful.
- Do not conclude "no useful memory" after a single weak lookup.

### 6. Personality and preferences recall

**Prompt:** `Help me plan this refactor in my usual style and decision-making mode.`

**Expected behavior:**
- Run a focused project recall first if project context matters.
- Run a separate semantic recall for personality, tone, autonomy, or coding preferences (no platform-tag gate — preferences are cross-project).
- Sort by `updated_desc` so the freshest preferences win.

### 7. Mid-conversation correction (atomic ritual)

**Prompt:** `Actually, I prefer tabs over spaces for indentation in this project. You keep using spaces.`

**Expected behavior:**
- Trigger phrase recognized ("actually," "I prefer," "you keep doing").
- Same turn, run all four steps:
  1. Recall (`limit: 5`) for the prior indentation/style memory.
  2. Store as `Preference`, importance 0.9, confidence 0.95, tags include `correction` and the project slug.
  3. Verify-recall on a distinctive phrase from the new content; retry the store once if not found (silent-fail insurance).
  4. If step 1 returned a related memory, associate `INVALIDATED_BY` (strength 0.9).
- The store does NOT wait for end-of-session.

### 8. Bare tags only — no platform, no date

**Prompt:** `Decided to use Postgres over MongoDB for the new analytics service — record the decision.`

**Expected behavior:**
- Store as `Decision`, importance 0.9, confidence 0.9.
- Tags are bare: `["decision", "<project-slug>", "postgres"]` (or similar). NOT `["decision", "cursor", "2026-04", ...]`.
- If MongoDB came up as a considered alternative, associate `PREFERS_OVER` (link to a MongoDB-related memory if one exists; skip the association if none plausible).
