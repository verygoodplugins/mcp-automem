# Cursor Rule Eval Set

Use this lightweight eval set whenever revising the Cursor memory rules. The goal is to verify layered loading behavior, adaptive recall, curated storage, selective associations, and the GPT-5.4 overlay behavior.

## Layering Scenarios

### A. Global only

**Setup:** Load only Cursor User Rules from `templates/cursor/user-rules.md`.

**Expected behavior:**
- Cross-project preference/style recall works without project tags
- The prompt stays thin and does not introduce storage, association, tagging, or GPT-5.4 workflow policy

### B. Project only

**Setup:** Load only `.cursor/rules/automem.mdc`.

**Expected behavior:**
- Project-context recall/store/update/associate behavior is available
- Recall defaults to project tags for project context
- GPT-5.4 overlay remains available in the project rule

### C. Global + project

**Setup:** Load both Cursor User Rules and `.cursor/rules/automem.mdc`.

**Expected behavior:**
- Global rules handle cross-project style/autonomy/preferences defaults
- Project rules handle operational memory workflow
- The two layers do not duplicate or contradict each other

### D. Global + project + custom mode

**Setup:** Load Cursor User Rules, `.cursor/rules/automem.mdc`, and a task-specific Custom Mode.

**Expected behavior:**
- The Custom Mode adds task shape only
- Memory policy still comes from the global + project layers
- The mode prompt does not restate recall/store/update/associate behavior

## Behavior Scenarios

## 1. Trivial typo fix

**Prompt:** `Fix the typo in README.md where "authenication" is misspelled.`

**Expected behavior:**
- Skip recall
- Inspect the file directly
- Do not store a memory unless a broader durable insight emerges

## 2. Architecture why-question

**Prompt:** `Why does this project use Redis for auth session caching instead of in-memory storage?`

**Expected behavior:**
- Start with one focused recall
- Use recalled context as supporting evidence, but confirm against the repo
- If memory and current code disagree, trust current evidence

## 3. Debugging task with durable fix

**Prompt:** `Login is timing out on slow networks after the last deploy. Find the cause and fix it.`

**Expected behavior:**
- Recall similar auth or timeout issues first
- After a real root cause is found, store a durable bug-fix/insight memory
- Associate it only if the relation to an existing memory is explicit and useful

## 4. Preference update or supersession

**Prompt:** `We no longer use Prettier with single quotes. Update the coding-style preference to double quotes.`

**Expected behavior:**
- Recall the existing preference if present
- Prefer `update_memory` or invalidation over creating a duplicate preference memory
- Store only the new durable preference state

## 5. Empty recall fallback

**Prompt:** `OAuth callbacks started failing after yesterday's deploy. Have we seen anything like this before?`

**Expected behavior:**
- Run a focused recall first
- If results are empty or suspiciously thin, retry with broader queries or different tags
- Continue with repo or log inspection even if memory is unhelpful
- Do not conclude "no useful memory" after a single weak lookup

## 6. Personality and preferences recall

**Prompt:** `Help me plan this refactor in my usual style and decision-making mode.`

**Expected behavior:**
- Run a focused project recall first if project context matters
- Run a separate semantic recall for personality, tone, autonomy, or coding preferences
- Do not hard-gate this preference lookup with platform tags unless platform-specific memories are explicitly required
