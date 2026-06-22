import { AUTHORABLE_RELATION_TYPES } from '../types.js';

export const AUTOMEM_POLICY_PROFILES = {
  rules: {
    preferenceRecallLimit: 20,
    contextRecallLimit: 30,
    debugRecallLimit: 20,
    contextRecallWindowDays: 90,
  },
  provider: {
    preferenceRecallLimit: 5,
    contextRecallLimit: 10,
    debugRecallLimit: 10,
    contextRecallWindowDays: 90,
  },
} as const;

export const AUTOMEM_POLICY_DEFAULTS = AUTOMEM_POLICY_PROFILES.rules;

export const AUTOMEM_PROVIDER_POLICY_DEFAULTS = AUTOMEM_POLICY_PROFILES.provider;

export const AUTOMEM_RULES_POLICY_DEFAULTS = AUTOMEM_POLICY_PROFILES.rules;

export const AUTOMEM_PROVIDER_EXPLICIT_RECALL_LIMIT = 10;

export type AutoMemPolicyProfile = keyof typeof AUTOMEM_POLICY_PROFILES;

export type AutoMemPolicyDefaults = typeof AUTOMEM_POLICY_PROFILES[AutoMemPolicyProfile];

export const AUTOMEM_POLICY_TRIGGER_HEADINGS = [
  '1. User correction or override.',
  '2. Decision stabilizes after at least one round of discussion.',
  '3. Pattern articulated - not inferred.',
] as const;

export const AUTOMEM_POLICY_ASSOCIATION_MAPPINGS = [
  'User correction -> Preference -> INVALIDATED_BY',
  'Architectural decision -> Decision -> PREFERS_OVER',
  'Pattern discovered -> Pattern -> EXEMPLIFIES',
] as const;

export const AMBIGUOUS_PROJECT_TAGS = ['api', 'app', 'test', 'video'] as const;
export const ENTITY_STOPWORDS = [
  'also',
  'and',
  'but',
  'can',
  'could',
  'does',
  'how',
  'should',
  'that',
  'then',
  'what',
  'when',
  'where',
  'which',
  'who',
  'why',
  'would',
] as const;
export const CASUAL_OPENING_PATTERN_SOURCE = String.raw`^(hi|hello|hey|yo|sup|thanks|thank you|ok|okay|cool|nice|great|ping|test|who are you)\b`;
export const DEBUG_PROMPT_PATTERN_SOURCE = String.raw`(error|exception|traceback|stack trace|stacktrace|failing|fails|failed|failure|bug|regression|crash|broken|debug|investigat|not work|doesn't work|does not work|cannot|can't|fix)`;
export const EXPLICIT_RECALL_PROMPT_PATTERN_SOURCE = String.raw`(what do (you|we) (have|know) about|what do you remember about|tell me about|who is|who's|do you remember|remember when|recall|search memory|check memory|look in memory|have we spoken about|what do you have on|do we like|how do we feel about|what do we think (of|about))`;
export const ENTITY_PATTERN_SOURCE = String.raw`\b(?:[A-Z][A-Za-z0-9_-]{2,}|[a-z0-9]+(?:-[a-z0-9]+)+)\b`;

const AMBIGUOUS_PROJECT_TAG_SET = new Set<string>(AMBIGUOUS_PROJECT_TAGS);
const CASUAL_OPENING_PATTERN = new RegExp(CASUAL_OPENING_PATTERN_SOURCE, 'i');
const DEBUG_PROMPT_PATTERN = new RegExp(DEBUG_PROMPT_PATTERN_SOURCE, 'i');
const EXPLICIT_RECALL_PROMPT_PATTERN = new RegExp(EXPLICIT_RECALL_PROMPT_PATTERN_SOURCE, 'i');

type ToolNames = {
  recall: string;
  store: string;
  update: string;
  associate: string;
};

function normalizeProjectTag(tag: string): string {
  return tag
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

export function isAmbiguousProjectTag(tag: string): boolean {
  return AMBIGUOUS_PROJECT_TAG_SET.has(normalizeProjectTag(tag));
}

export function buildDefaultProjectTags(projectName?: string): string[] {
  const normalizedProjectName = String(projectName || '').replace(/^@.*?\//, '');
  const sanitized = normalizeProjectTag(normalizedProjectName);
  if (!sanitized || isAmbiguousProjectTag(sanitized)) {
    return [];
  }
  return [sanitized];
}

export function resolveProjectGateTags(defaultTags: string[]): string[] | undefined {
  const normalized = defaultTags
    .map((tag) => normalizeProjectTag(tag))
    .filter((tag) => tag && !isAmbiguousProjectTag(tag));
  const deduped = [...new Set(normalized)];
  return deduped.length > 0 ? deduped : undefined;
}

export function isSubstantivePrompt(prompt: string): boolean {
  const normalized = String(prompt || '').replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return false;
  }

  const wordCount = normalized.split(' ').filter(Boolean).length;
  if (CASUAL_OPENING_PATTERN.test(normalized) && wordCount <= 4) {
    return false;
  }

  return wordCount >= 3 || DEBUG_PROMPT_PATTERN.test(normalized) || /[?]/.test(normalized);
}

export function looksLikeDebugPrompt(prompt: string): boolean {
  return DEBUG_PROMPT_PATTERN.test(String(prompt || ''));
}

export function looksLikeExplicitRecallPrompt(prompt: string): boolean {
  return EXPLICIT_RECALL_PROMPT_PATTERN.test(String(prompt || ''));
}

export function renderClaudeCodeSessionStartPrompt(projectExpression: string): string {
  return [
    '<automem_session_context>',
    'MEMORY RECALL - run both recalls before your first substantive response. They are independent: issue them in parallel in a single message.',
    '',
    'Phase 1 - Preferences (tag-only, no time filter, no query):',
    '  recall_memory({',
    '    tags: ["preference"],',
    `    limit: ${AUTOMEM_POLICY_DEFAULTS.preferenceRecallLimit},`,
    '    sort: "updated_desc"',
    '  })',
    '',
    `Phase 2 - Task context (ONE semantic query from the user's actual nouns; project-slug gate when unambiguous; ${AUTOMEM_POLICY_DEFAULTS.contextRecallWindowDays}-day window):`,
    '  recall_memory({',
    '    query: "<proper nouns, product names, people, tools, specific topics from the user\'s message>",',
    `    tags: ["${projectExpression}"],    // drop if slug collides with a common word`,
    `    time_query: "last ${AUTOMEM_POLICY_DEFAULTS.contextRecallWindowDays} days",`,
    `    limit: ${AUTOMEM_POLICY_DEFAULTS.contextRecallLimit}`,
    '  })',
    '',
    `Project slug: ${projectExpression}`,
    '',
    'During work - store durable memories when triggers fire:',
    '- Do not wait for a Stop hook or session end. When a durable correction, stabilized decision, articulated pattern, or root-cause insight appears, run recall -> store -> verify -> associate in that same turn.',
    '- Use type, importance, confidence, and bare tags on every store; verify by recalling a distinctive phrase; associate when a plausible related memory exists.',
    '- Skip storage for session summaries, progress notes, confirmations, temporary output, and speculative context.',
    '',
    'Notes:',
    '- Tags are a HARD GATE - they filter before scoring. Use only the tag sets above; never invent topic tags. Bare tags only - no namespace prefixes (`project/*`, `lang/*`).',
    `- Debugging recall is ON-DEMAND: when the user reports an error symptom, recall with the symptom as a semantic query and NO tags (a tag gate hides cross-corpus fixes), limit ${AUTOMEM_POLICY_DEFAULTS.debugRecallLimit}.`,
    '- Phase 2 uses ONE targeted query, not `queries[]` + `auto_decompose`. Sub-queries converge and dedup drops results; reserve `queries[]` for genuinely multi-topic questions.',
    '- If the project slug collides with a common topic word (for example `video` or `test`), drop the Phase 2 tag gate and rely on semantic `query` alone.',
    '- Results show created/updated timestamps and importance - prefer fresh, high-importance memories. Fetch a single full record with recall_memory({ memory_id: "<id>" }) when needed.',
    '- Do not re-recall every turn. After turn 1, recall again only for topic shifts, new proper nouns, or active debugging.',
    '- If recall fails or returns nothing, continue without memory - do not mention the failure to the user.',
    '</automem_session_context>',
  ].join('\n');
}

export function renderClaudeCodeSessionStartHook(): string {
  const projectToken = '__AUTOMEM_PROJECT__';
  const shellPrompt = renderClaudeCodeSessionStartPrompt(projectToken)
    .replace(/\\/g, '\\\\')
    .replace(/`/g, '\\`')
    .replace(/\$/g, '\\$')
    .replaceAll(projectToken, '$PROJECT');
  return [
    '#!/bin/bash',
    '# AutoMem SessionStart hook - prompts Claude to run two-phase recall.',
    '# Claude executes the MCP tool calls; this script just injects the prompt.',
    '# Generated by scripts/sync-memory-policy.ts. Do not edit by hand.',
    '',
    '# Emit at most once per session: residual double-registration (legacy settings',
    '# entry + plugin, or path-variant duplicates) must not inject the prompt twice.',
    '# Hook stdin is JSON that includes session_id; no stdin/session_id -> always emit.',
    'SESSION_ID=""',
    'HOOK_SOURCE=""',
    'if [ ! -t 0 ]; then',
    '  HOOK_INPUT=$(cat 2>/dev/null || true)',
    '  SESSION_ID=$(printf \'%s\' "$HOOK_INPUT" | sed -n \'s/.*"session_id"[[:space:]]*:[[:space:]]*"\\([^"]*\\)".*/\\1/p\' | head -n 1 | tr -cd \'A-Za-z0-9_-\')',
    '  HOOK_SOURCE=$(printf \'%s\' "$HOOK_INPUT" | sed -n \'s/.*"source"[[:space:]]*:[[:space:]]*"\\([^"]*\\)".*/\\1/p\' | head -n 1 | tr -cd \'A-Za-z0-9_-\')',
    'fi',
    'if [ -n "$SESSION_ID" ]; then',
    '  SENTINEL="${TMPDIR:-/tmp}/automem-session-start-${SESSION_ID}${HOOK_SOURCE:+-$HOOK_SOURCE}"',
    '  if [ -e "$SENTINEL" ]; then',
    '    exit 0',
    '  fi',
    '  : > "$SENTINEL" 2>/dev/null || true',
    'fi',
    '',
    'PROJECT=$(basename "$PWD")',
    '',
    'cat << EOF',
    shellPrompt,
    'EOF',
    '',
  ].join('\n');
}

/**
 * Minimum human prompts in the session transcript before the Stop nudge may
 * fire. Below this the session is too short to plausibly contain a durable
 * fact, and the Stop hook context cost is pure noise on hosts that still show
 * or immediately act on Stop additionalContext. Mirrored in
 * tests/hooks/automem-stop-nudge.test.ts.
 */
export const AUTOMEM_STOP_NUDGE_MIN_HUMAN_TURNS = 5;

export function renderClaudeCodeStopNudgePrompt(): string {
  // One factual line on purpose: Claude Code's docs say additionalContext is
  // hidden context, but command-like wording can trigger prompt-injection
  // defenses and older Stop behavior has surfaced the text. Keep this phrased
  // as environment state rather than an imperative instruction.
  return (
    'AutoMem status: no memory has been stored this session. ' +
    'Durable candidates: corrections, stabilized decisions, articulated patterns, and root-cause insights. ' +
    'Non-candidates: session summaries, progress notes, confirmations, and temporary output.'
  );
}

const STDIN_FIELD_SED = (field: string): string =>
  `sed -n 's/.*"${field}"[[:space:]]*:[[:space:]]*"\\([^"]*\\)".*/\\1/p' | head -n 1`;

export function renderClaudeCodeStopNudgeHook(): string {
  // JSON-encode the nudge at generation time so the script only interpolates
  // the event name; single quotes in the prompt would break the shell literal.
  const contextJson = JSON.stringify(renderClaudeCodeStopNudgePrompt());
  const shellQuotedContext = `'${contextJson.replace(/'/g, `'\\''`)}'`;
  return [
    '#!/bin/bash',
    '# AutoMem Stop hook - one-shot LLM-judged storage nudge.',
    '# If no store_memory call happened this session (tracked by',
    '# automem-track-store.sh via the automem-stored-<session_id> sentinel) and',
    `# the transcript shows a substantive session (>= ${AUTOMEM_STOP_NUDGE_MIN_HUMAN_TURNS} human prompts), emits`,
    '# hookSpecificOutput.additionalContext with neutral AutoMem state. The',
    '# wording is factual, not command-like, so hosts that support hidden Stop',
    '# context can pass it silently; older hosts may still surface or act on it.',
    '# Advisory only: never blocks, never exits 2.',
    '# Generated by scripts/sync-memory-policy.ts. Do not edit by hand.',
    '',
    'SESSION_ID=""',
    'EVENT_NAME="Stop"',
    'TRANSCRIPT_PATH=""',
    'if [ ! -t 0 ]; then',
    '  HOOK_INPUT=$(cat 2>/dev/null || true)',
    `  SESSION_ID=$(printf '%s' "$HOOK_INPUT" | ${STDIN_FIELD_SED('session_id')} | tr -cd 'A-Za-z0-9_-')`,
    `  EVENT_RAW=$(printf '%s' "$HOOK_INPUT" | ${STDIN_FIELD_SED('hook_event_name')})`,
    `  TRANSCRIPT_PATH=$(printf '%s' "$HOOK_INPUT" | ${STDIN_FIELD_SED('transcript_path')})`,
    '  if [ "$EVENT_RAW" = "SubagentStop" ]; then',
    '    EVENT_NAME="SubagentStop"',
    '  fi',
    'fi',
    '',
    '# No session_id -> no dedup possible. Stay silent rather than risk a',
    '# nudge -> conversation continues -> Stop -> nudge loop.',
    'if [ -z "$SESSION_ID" ]; then',
    '  exit 0',
    'fi',
    '',
    '# Stored sentinel: a store_memory call already happened -> nothing to nudge.',
    '# Nudged sentinel: we already nudged once -> stay silent on re-entry.',
    'STORED_SENTINEL="${TMPDIR:-/tmp}/automem-stored-${SESSION_ID}"',
    'NUDGED_SENTINEL="${TMPDIR:-/tmp}/automem-stop-nudged-${SESSION_ID}"',
    'if [ -e "$STORED_SENTINEL" ] || [ -e "$NUDGED_SENTINEL" ]; then',
    '  exit 0',
    'fi',
    '',
    '# Substantive-session gate: even hidden context costs processing and older',
    '# hosts may still surface Stop context, so it only fires once the session',
    '# has enough human prompts to plausibly contain something durable. Human prompts ~=',
    '# transcript user entries that are neither tool results nor meta entries.',
    '# No readable transcript or an unparseable count -> stay silent (silence is',
    '# the safe failure; Windows transcript paths arrive JSON-escaped and',
    '# unreadable here, so the gate is effectively POSIX-only).',
    'if [ -z "$TRANSCRIPT_PATH" ] || [ ! -r "$TRANSCRIPT_PATH" ]; then',
    '  exit 0',
    'fi',
    'HUMAN_TURNS=$(grep \'"type"[[:space:]]*:[[:space:]]*"user"\' "$TRANSCRIPT_PATH" 2>/dev/null | grep -v \'tool_use_id\' | grep -cv \'"isMeta"[[:space:]]*:[[:space:]]*true\')',
    'case "$HUMAN_TURNS" in',
    "  ''|*[!0-9]*) exit 0 ;;",
    'esac',
    '# Below the threshold: exit WITHOUT writing the nudged sentinel so a later',
    '# Stop in this session can still nudge once the conversation crosses it.',
    `if [ "$HUMAN_TURNS" -lt ${AUTOMEM_STOP_NUDGE_MIN_HUMAN_TURNS} ]; then`,
    '  exit 0',
    'fi',
    '',
    '# Write the sentinel before emitting so a re-entrant Stop sees it. If it',
    "# can't be created (e.g. TMPDIR not writable), the once-per-session guarantee",
    '# is gone, so stay silent rather than nudge on every Stop.',
    'if ! : > "$NUDGED_SENTINEL" 2>/dev/null; then',
    '  exit 0',
    'fi',
    '',
    `printf '{"suppressOutput":true,"hookSpecificOutput":{"hookEventName":"%s","additionalContext":%s}}\\n' "$EVENT_NAME" ${shellQuotedContext}`,
    '',
    '# Advisory hook: always succeed even if printf hit a write error, so Claude',
    '# Code never treats the Stop hook as failed and discards the JSON.',
    'exit 0',
    '',
  ].join('\n');
}

export function renderClaudeCodeTrackStoreHook(): string {
  return [
    '#!/bin/bash',
    '# AutoMem PostToolUse tracker for store_memory calls (any MCP prefix).',
    '# Writes a session sentinel so the optional Stop-hook storage nudge',
    '# (automem-stop-nudge.sh) can stay quiet when it is enabled.',
    '# Side-effect only: no output, always exits 0.',
    '# Generated by scripts/sync-memory-policy.ts. Do not edit by hand.',
    '',
    'SESSION_ID=""',
    'if [ ! -t 0 ]; then',
    '  HOOK_INPUT=$(cat 2>/dev/null || true)',
    `  SESSION_ID=$(printf '%s' "$HOOK_INPUT" | ${STDIN_FIELD_SED('session_id')} | tr -cd 'A-Za-z0-9_-')`,
    'fi',
    'if [ -n "$SESSION_ID" ]; then',
    '  : > "${TMPDIR:-/tmp}/automem-stored-${SESSION_ID}" 2>/dev/null || true',
    'fi',
    'exit 0',
    '',
  ].join('\n');
}

export type PolicyTemplateOptions = {
  templateVersion: string;
};

export type ToolRuleRenderOptions = PolicyTemplateOptions & {
  projectName: string;
  toolPrefix?: string;
};

function quote(value: string): string {
  return JSON.stringify(value);
}

function renderToolCallName(toolPrefix: string, toolName: string): string {
  return `${toolPrefix}${toolName}`;
}

function renderToolBehaviorSection(): string {
  return [
    "## Tool's real behavior (validated against production corpus)",
    '',
    '- **Tags are a hard gate** - memories without matching tags are excluded before scoring. Use tags for stable categories like `preference` and `bugfix`; do not guess topic tags.',
    '- **One good query beats `queries[]` + `auto_decompose`** for focused tasks. Use `queries[]` only for genuinely multi-topic questions.',
    '- **`limit` caps at 50.** Routine recall should use enough budget to be useful.',
    '- **Default `text` format shows content previews with created/updated timestamps and importance.** `detailed` adds type/confidence/metadata summary. Responses are budget-capped; fetch a full record with `recall_memory({ memory_id })`.',
    '- **`store_memory` can silently fail.** Verify important stores by recalling a distinctive phrase; retry once if missing.',
    '- **Bare tag convention** - use `automem`, not `project/automem`; no `lang/` prefixes, platform tags, or date-stamped tags. `entity:*:*` tags are server-injected.',
    '',
    '### Slug-collision rule',
    '',
    `Drop the project tag gate when the slug collides with common topic words: ${AMBIGUOUS_PROJECT_TAGS.map((tag) => `\`${tag}\``).join(', ')}. Use semantic query alone in that case.`,
  ].join('\n');
}

function renderRecallRulesSection(params: {
  projectName: string;
  toolPrefix: string;
  desktop?: boolean;
  cursor?: boolean;
}): string {
  const recall = renderToolCallName(params.toolPrefix, 'recall_memory');
  const projectTagLine = params.desktop
    ? ''
    : `  tags: [${quote(params.projectName)}],        // drop if slug collides with a common word\n`;
  const cursorRankers = params.cursor
    ? '  language: "<typescript|python|...>", // optional ranker - boosts, does not gate\n  active_path: "<current file path>"   // optional Cursor ranker\n'
    : '  language: "<typescript|python|go|rust|...>" // optional ranker\n';
  const heading = params.desktop
    ? '## Conversation start - semantic-first recall'
    : '## Session start — two-phase recall';

  const escalation = [
    '### When recall misses',
    '',
    'Escalate only when the task-context recall comes back too broad or empty:',
    '',
    '- **Too broad** - add a tag gate (a stable category like `preference`/`bugfix`, or the unambiguous project slug) and tighten the query to the real nouns.',
    '- **Empty** - drop the time window first (the topic may be dormant-but-important), then broaden the query.',
    '- **Sparse under a tag gate** - drop the gate and rely on the semantic query alone; older memories use `project/<slug>` prefixes, so gated queries can miss historical content.',
    '- **Need graph traversal** - use `expand_relations: true`; add `expand_respect_tags: true` when traversal must stay inside the tag gate, or leave it false/drop tags when broader graph context is useful.',
  ].join('\n');

  return [
    heading,
    '',
    params.desktop
      ? 'Desktop has no reliable project slug on most first turns, so prefer preferences plus one semantic task query. Add a tag gate only after the user clearly scopes to a project.'
      : `Standardized defaults: preferences limit ${AUTOMEM_RULES_POLICY_DEFAULTS.preferenceRecallLimit}, task-context limit ${AUTOMEM_RULES_POLICY_DEFAULTS.contextRecallLimit}, ${AUTOMEM_RULES_POLICY_DEFAULTS.contextRecallWindowDays}-day task window.`,
    '',
    'Preferences and task context are independent recalls - issue them in parallel in a single message.',
    '',
    'Preferences first:',
    '',
    '```javascript',
    `${recall}({`,
    '  tags: ["preference"],',
    `  limit: ${AUTOMEM_RULES_POLICY_DEFAULTS.preferenceRecallLimit},`,
    '  sort: "updated_desc"',
    '})',
    '```',
    '',
    'Task context: one semantic query built from proper nouns, products, files, error strings, tools, and specific topics in the user message.',
    '',
    '```javascript',
    `${recall}({`,
    '  query: "<proper nouns, product names, people, tools, specific topics from the user\'s message>",',
    `${projectTagLine}  time_query: "last ${AUTOMEM_RULES_POLICY_DEFAULTS.contextRecallWindowDays} days",`,
    `  limit: ${AUTOMEM_RULES_POLICY_DEFAULTS.contextRecallLimit},`,
    cursorRankers.trimEnd(),
    '})',
    '```',
    '',
    'Skip task-context recall for pure syntax questions, trivial edits, one-off calculations, direct factual queries about current files, or casual openings.',
    '',
    'Debug context, only when actively investigating a concrete symptom:',
    '',
    '```javascript',
    `${recall}({`,
    '  query: "<error symptom or exact message>",',
    `  limit: ${AUTOMEM_RULES_POLICY_DEFAULTS.debugRecallLimit}`,
    '})',
    '```',
    '',
    'No tag gate on debug recall - bugfix/solution tagging is incomplete and a hard gate hides cross-corpus fixes.',
    '',
    "Don't re-recall mid-conversation unless the topic genuinely shifts, a new proper noun enters, or active debugging starts.",
    '',
    escalation,
  ].join('\n');
}

function renderStorageRulesSection(toolPrefix: string, projectName: string): string {
  const recall = renderToolCallName(toolPrefix, 'recall_memory');
  const store = renderToolCallName(toolPrefix, 'store_memory');
  const update = renderToolCallName(toolPrefix, 'update_memory');
  const associate = renderToolCallName(toolPrefix, 'associate_memories');

  return [
    '## Storage Discipline',
    '',
    'Store only durable decisions, corrections, explicit preferences, bug-fix root causes, and articulated reusable patterns. Never store secrets, credentials, tokens, PII, session summaries, progress reports, confirmations, speculative context, or attentiveness notes.',
    '',
    '```javascript',
    `${store}({`,
    '  content: "Brief title. Context + reasoning. Outcome.",',
    '  type: "Decision",',
    `  tags: ["<category>", ${quote(projectName)}, "<language>"], // bare strings; NO platform tag, NO [YYYY-MM]`,
    '  importance: 0.85,',
    '  confidence: 0.9',
    '})',
    '```',
    '',
    'Use content of 150-300 chars when possible; put file paths, metrics, exit codes, and other structured details in `metadata`. For facts with a shelf life, use `t_valid` and `t_invalid` instead of date tags.',
    '',
    '### Three mid-conversation triggers (and only three)',
    '',
    '1. **User correction or override.** Listen for: "actually", "no, I prefer", "not X, Y", "that\'s wrong", "stop doing X", "never do X", "I told you before", "we decided X already". Store as `Preference`, importance 0.9, confidence 0.95, tag `correction`, then associate `INVALIDATED_BY` the prior memory.',
    '2. **Decision stabilizes after at least one round of discussion.** Listen for: "let\'s go with X", "yeah that\'s the plan", "ship it", "do it that way", "final answer", "okay let\'s do that". Store as `Decision`, importance 0.85-0.9, then associate `PREFERS_OVER` alternatives if they came up.',
    '3. **Pattern articulated - not inferred.** Listen for: "I always do X", "every time", "this is how I usually", "my thing is". Store as `Pattern`, importance 0.8, then associate concrete examples with `EXEMPLIFIES`.',
    '',
    '### The atomic ritual - every store runs all four steps',
    '',
    '```javascript',
    `const related = await ${recall}({ query: "<what is being corrected / decided / named>", limit: 5 })`,
    `const stored = await ${store}({`,
    '  content: "Brief title. Context + reasoning. Outcome.",',
    '  type: "Preference",',
    `  tags: ["correction", ${quote(projectName)}],`,
    '  importance: 0.9,',
    '  confidence: 0.95',
    '})',
    `await ${recall}({ query: "<distinctive phrase from content>", limit: 3 })`,
    'if (related?.results?.length) {',
    `  await ${associate}({ memory1_id: related.results[0].id, memory2_id: stored.memory_id, type: "INVALIDATED_BY", strength: 0.9 })`,
    '}',
    '```',
    '',
    'Step 4 is where the graph gets built. Skipping it is the main reason AutoMem degrades into a flat bag of notes.',
    '',
    '### Mandatory association pairings',
    '',
    '| Trigger | Store as | Then associate |',
    '|---|---|---|',
    '| User correction | `Preference`, 0.9 / 0.95 | Old memory -> `INVALIDATED_BY` |',
    '| Architectural decision | `Decision`, 0.9 / 0.9 | Alternatives -> `PREFERS_OVER` |',
    '| Bug fix | `Insight`, 0.75 / 0.85, tags `bugfix` + `solution` | Bug report -> `LEADS_TO` |',
    '| Pattern discovered | `Pattern`, 0.8 | Concrete examples -> `EXEMPLIFIES` |',
    '| Knowledge evolved | `update_memory` old + store new | Old -> `EVOLVED_INTO` |',
    '| Deprecated info | `update_memory` old with deprecated metadata | Old <- `INVALIDATED_BY` |',
    '',
    `Prefer ${update} over a duplicate store when a fact changes in place.`,
    `Valid relation types for ${associate}: ${renderRelationTypesInline()}.`,
  ].join('\n');
}

function renderMemoryVsCurrentState(): string {
  return [
    '## Memory vs current state',
    '',
    "Recalled context is a prior, not ground truth. If a memory disagrees with the current repo state, the user's latest instruction, or a freshly read file - **current evidence wins**. Update or invalidate stale memory instead of acting on it.",
    '',
    'If recall fails or returns nothing, continue without memory and do not mention the failure to the user. Weave recalled context naturally.',
  ].join('\n');
}

export function renderCodexMemoryRules(params: ToolRuleRenderOptions): string {
  const toolPrefix = params.toolPrefix ?? 'mcp__memory__';
  return [
    '<!-- BEGIN AUTOMEM CODEX RULES -->',
    `<!-- automem-template-version: ${params.templateVersion} -->`,
    '',
    `## Memory - AutoMem (persistent context for ${params.projectName})`,
    '',
    'AutoMem is wired as the `memory` MCP server (see `~/.codex/config.toml`). Tools are `mcp__memory__*`. Use this layer proactively for continuity across turns.',
    '',
    renderToolBehaviorSection(),
    '',
    renderRecallRulesSection({ projectName: params.projectName, toolPrefix }),
    '',
    renderStorageRulesSection(toolPrefix, params.projectName),
    '',
    '## Guidelines',
    '',
    '- Weave recalled context naturally; do not announce memory operations.',
    '- Prefer high-signal memories: decisions, root causes, reusable patterns, and explicit preferences.',
    '- Avoid wall-of-text memories; keep them atomic and focused.',
    '',
    renderMemoryVsCurrentState(),
    '',
    '<!-- END AUTOMEM CODEX RULES -->',
    '',
  ].join('\n');
}

export type CursorProjectRuleOptions = ToolRuleRenderOptions & {
  mcpServerName: string;
  mcpToolPrefix: string;
};

export function renderCursorProjectRule(params: CursorProjectRuleOptions): string {
  return [
    '---',
    'description: AutoMem persistent memory - validated two-phase recall, curated storage, mandatory associations',
    'alwaysApply: true',
    '---',
    `<!-- automem-template-version: ${params.templateVersion} -->`,
    `<!-- automem-mdc-version: ${params.templateVersion} -->`,
    '',
    '# AutoMem Memory Integration',
    '',
    `Use AutoMem proactively to maintain persistent context across sessions for ${params.projectName}. Preserve host/platform instructions; this rule adds project-level memory behavior.`,
    '',
    `Tools are \`${params.mcpToolPrefix}*\` (e.g. \`${params.mcpToolPrefix}recall_memory\`). Cursor MCP server: \`${params.mcpServerName}\`.`,
    '',
    renderToolBehaviorSection(),
    '',
    renderRecallRulesSection({
      projectName: params.projectName,
      toolPrefix: params.mcpToolPrefix,
      cursor: true,
    }),
    '',
    renderStorageRulesSection(params.mcpToolPrefix, params.projectName),
    '',
    '## Optional GPT-5.4 Overlay',
    '',
    '- Be persistent with tools when recall or verification is needed; do not stop after a weak first result.',
    '- If recall is empty or thin, retry with a broader query or drop the tag gate before concluding there is no useful memory.',
    '- Keep responses compact by default.',
    '- Ask only when a missing choice materially changes the outcome.',
    '',
    renderMemoryVsCurrentState(),
    '',
    '## Error Handling',
    '',
    '- Recall fails or stays empty after retries: continue without historical context.',
    '- Store fails: complete the task normally. Memory is enhancement, not requirement.',
    '- Service unavailable: focus on solving the immediate problem.',
    '',
    'Memory is your persistent brain across sessions. Use it strategically - 200 sharp memories beat 2000 fuzzy ones.',
    '',
  ].join('\n');
}

export function renderClaudeDesktopInstructions(params: PolicyTemplateOptions): string {
  const toolPrefix = 'mcp__memory__';
  return [
    '# Claude Desktop Personal Preferences Template',
    '',
    `<!-- automem-template-version: ${params.templateVersion} -->`,
    '',
    'Copy everything below the divider into **Claude Desktop -> Settings -> Profile -> Personal Preferences**.',
    '',
    'If your MCP server key is not `memory`, replace `mcp__memory__*` with Claude Desktop\'s tool prefix for your server.',
    '',
    '---',
    '',
    'You have access to **AutoMem** - a persistent memory system with graph relationships and semantic search - via MCP. Use it strategically to provide continuity across conversations.',
    '',
    '> Tool names are client-specific. Examples below assume your MCP server key is `memory`, so they use `mcp__memory__*`. Adapt to your prefix.',
    '',
    '## Memory - Desktop is semantic-first',
    '',
    'Desktop conversations often are not project-scoped. Use semantic recall from the actual content nouns first; add tags only when the user clearly scopes the task.',
    '',
    renderToolBehaviorSection(),
    '',
    renderRecallRulesSection({
      projectName: '<project-slug>',
      toolPrefix,
      desktop: true,
    }),
    '',
    renderStorageRulesSection(toolPrefix, '<project-slug>'),
    '',
    renderMemoryVsCurrentState(),
    '',
  ].join('\n');
}

export type HermesInstallMode = 'mcp' | 'provider' | 'both';

const HERMES_MCP_TOOL_NAMES = [
  'mcp_automem_recall_memory',
  'mcp_automem_store_memory',
  'mcp_automem_associate_memories',
  'mcp_automem_update_memory',
  'mcp_automem_check_database_health',
] as const;

const HERMES_PROVIDER_TOOL_NAMES = [
  'automem_recall_memory',
  'automem_store_memory',
  'automem_associate_memories',
  'automem_update_memory',
  'automem_check_database_health',
] as const;

function renderMarkdownToolList(toolNames: readonly string[]): string {
  return toolNames.map((toolName) => `- \`${toolName}\``).join('\n');
}

export function renderHermesModeRules(mode: HermesInstallMode): string {
  if (mode === 'provider') {
    return [
      '## Provider-only mode',
      '',
      "Hermes is using AutoMem through `memory.provider: automem`. Ambient recall is injected before model calls through Hermes' memory provider lifecycle. When explicit memory tools are available, use these provider tool names:",
      '',
      renderMarkdownToolList(HERMES_PROVIDER_TOOL_NAMES),
      '',
      'Recall once early in substantive work, store only high-signal corrections/decisions/patterns, verify the stored memory can be recalled, and associate it with related memories when there is a meaningful relationship.',
    ].join('\n');
  }

  if (mode === 'both') {
    return [
      '## Both mode',
      '',
      'Hermes uses the native provider for ambient recall and the MCP server for explicit tools. The provider explicit tools are disabled with `AUTOMEM_HERMES_PROVIDER_TOOLS=false`, leaving one explicit tool surface:',
      '',
      renderMarkdownToolList(HERMES_MCP_TOOL_NAMES),
      '',
      'Recall once early in substantive work, store only high-signal corrections/decisions/patterns, verify the stored memory can be recalled, and associate it with related memories when there is a meaningful relationship.',
    ].join('\n');
  }

  return [
    '## MCP-only mode',
    '',
    'Hermes is using AutoMem as an MCP server. Use these tool names:',
    '',
    renderMarkdownToolList(HERMES_MCP_TOOL_NAMES),
    '',
    'Recall once early in substantive work, store only high-signal corrections/decisions/patterns, verify the stored memory can be recalled, and associate it with related memories when there is a meaningful relationship.',
  ].join('\n');
}

export function renderHermesMemoryRules(params: PolicyTemplateOptions & {
  projectName: string;
  modeRules: string;
}): string {
  return [
    '<!-- BEGIN AUTOMEM HERMES RULES -->',
    `<!-- automem-template-version: ${params.templateVersion} -->`,
    '# Memory - AutoMem for Hermes',
    '',
    `AutoMem is installed for Hermes in this project (\`${params.projectName}\`). Use it proactively for durable memory, not as a passive reference lookup.`,
    '',
    params.modeRules,
    '',
    '## Storage Discipline',
    '',
    '- Store corrections immediately when the user corrects a durable preference, naming, approach, or factual claim.',
    '- Store decisions when the user settles a direction that affects future work.',
    '- Store articulated patterns when the user says they always do something or wants a recurring behavior preserved.',
    '- Do not store secrets, credentials, tokens, PII, session summaries, progress reports, or attentiveness notes.',
    '- Use bare tags such as `automem`, `hermes`, `typescript`, `bugfix`, `decision`, and `preference`.',
    '- Prefer current repository evidence over recalled memory when they conflict.',
    '<!-- END AUTOMEM HERMES RULES -->',
    '',
  ].join('\n');
}

function renderPythonStringSet(values: readonly string[]): string {
  return `{${values.map((value) => quote(value)).join(', ')}}`;
}

function renderPythonRawRegex(source: string): string {
  return `r"""${source.replace(/"""/g, '\\"\\"\\"')}"""`;
}

export function renderHermesProviderPolicyPython(): string {
  const provider = AUTOMEM_PROVIDER_POLICY_DEFAULTS;
  return [
    '"""Generated AutoMem policy constants for the Hermes provider.',
    '',
    'Generated by scripts/sync-memory-policy.ts. Do not edit by hand.',
    '"""',
    '',
    'import re',
    '',
    `DEFAULT_RECALL_LIMIT = ${provider.preferenceRecallLimit}`,
    `PREFERENCE_RECALL_LIMIT = ${provider.preferenceRecallLimit}`,
    `CONTEXT_RECALL_LIMIT = ${provider.contextRecallLimit}`,
    `DEBUG_RECALL_LIMIT = ${provider.debugRecallLimit}`,
    `CONTEXT_RECALL_WINDOW_DAYS = ${provider.contextRecallWindowDays}`,
    `MAX_EXPLICIT_RECALL_LIMIT = ${AUTOMEM_PROVIDER_EXPLICIT_RECALL_LIMIT}`,
    `AMBIGUOUS_PROJECT_TAGS = ${renderPythonStringSet(AMBIGUOUS_PROJECT_TAGS)}`,
    `ENTITY_STOPWORDS = ${renderPythonStringSet(ENTITY_STOPWORDS)}`,
    '',
    `CASUAL_OPENING_PATTERN = re.compile(${renderPythonRawRegex(CASUAL_OPENING_PATTERN_SOURCE)}, re.IGNORECASE)`,
    `DEBUG_PROMPT_PATTERN = re.compile(${renderPythonRawRegex(DEBUG_PROMPT_PATTERN_SOURCE)}, re.IGNORECASE)`,
    `EXPLICIT_RECALL_PROMPT_PATTERN = re.compile(${renderPythonRawRegex(EXPLICIT_RECALL_PROMPT_PATTERN_SOURCE)}, re.IGNORECASE)`,
    `ENTITY_PATTERN = re.compile(${renderPythonRawRegex(ENTITY_PATTERN_SOURCE)})`,
    '',
    'PREFETCH_POLICY_HINTS = {',
    '    "preference_sort": "updated_desc",',
    '    "task_time_query": f"last {CONTEXT_RECALL_WINDOW_DAYS} days",',
    '    "topic_shift_rule": "recall on topic shift, explicit recall, or active debug only",',
    '}',
    '',
  ].join('\n');
}

export type OpenClawPolicyLimits = {
  preferenceRecallLimit?: number;
  contextRecallLimit?: number;
  debugRecallLimit?: number;
  contextRecallWindowDays?: number;
};

export function renderOpenClawPolicyContext(params: {
  defaultTags: string[];
  tools?: Partial<ToolNames>;
  limits?: OpenClawPolicyLimits;
}): string {
  const tools: ToolNames = {
    recall: params.tools?.recall || 'automem_recall_memory',
    store: params.tools?.store || 'automem_store_memory',
    update: params.tools?.update || 'automem_update_memory',
    associate: params.tools?.associate || 'automem_associate_memories',
  };
  const preferenceLimit =
    params.limits?.preferenceRecallLimit ?? AUTOMEM_POLICY_DEFAULTS.preferenceRecallLimit;
  const contextLimit =
    params.limits?.contextRecallLimit ?? AUTOMEM_POLICY_DEFAULTS.contextRecallLimit;
  const debugLimit = params.limits?.debugRecallLimit ?? AUTOMEM_POLICY_DEFAULTS.debugRecallLimit;
  const windowDays =
    params.limits?.contextRecallWindowDays ?? AUTOMEM_POLICY_DEFAULTS.contextRecallWindowDays;
  const projectGate = resolveProjectGateTags(params.defaultTags);
  const projectGateLine = projectGate
    ? `Project gate for first-turn task-context recall: ${projectGate.join(', ')}`
    : 'Project gate for first-turn task-context recall: none - use semantic query only.';
  const projectSlugHint = projectGate ? `"${projectGate[0]}"` : '"your-project-slug"';

  return [
    '<automem-policy>',
    'Use AutoMem with the validated shared policy.',
    '',
    'Recall rules:',
    `- First substantive turn: run ${tools.recall} for preferences with tags ["preference"], limit ${preferenceLimit}, sort "updated_desc". In parallel, run ONE semantic task-context recall using the user's real nouns, time_query "last ${windowDays} days", limit ${contextLimit}, and only use the project gate when it is unambiguous.`,
    `- Active debugging only: run ${tools.recall} with the error symptom as a semantic query, NO tags (a tag gate hides cross-corpus fixes), limit ${debugLimit}.`,
    '- After turn 1, recall again only for topic shifts, new proper nouns, or active debugging. Do not re-recall on routine follow-ups.',
    `- If the user explicitly asks what you know about a person, project, or topic, run ${tools.recall} before answering from memory. Do not promise a "live recall" without doing it.`,
    '',
    'Tag discipline for tool calls (tags are a hard gate, not a hint):',
    `- Valid tag sets for ${tools.recall}: ["preference"] or the project slug (e.g. [${projectSlugHint}]). Otherwise drop tags and rely on the query.`,
    '- Never invent topic-word tags from the prompt (e.g. ["voiceink", "autohub"]). Put those nouns in query, not tags.',
    '- Bare strings only. No namespace prefixes (project/*, lang/*), no platform tags (cursor, claude-code), no date-stamped tags.',
    '',
    'Mid-conversation stores fire the atomic ritual on exactly these three triggers. Listen for the trigger phrases; do not queue stores for session-end.',
    '',
    '1. User correction or override.',
    '   Listen for: "actually", "no, I prefer", "not X, Y", "that\'s wrong", "stop doing X", "never do X", "I told you before", "we decided X already".',
    `   -> ${tools.store} as Preference, importance 0.9, confidence 0.95, include "correction" in tags. Then ${tools.associate} INVALIDATED_BY the old memory (strength 0.9). Fire this turn, not later.`,
    '',
    '2. Stabilized decision (survived at least one round of discussion).',
    '   Listen for: "let\'s go with X", "yeah that\'s the plan", "ship it", "do it that way", "final answer", "okay let\'s do that".',
    `   -> ${tools.store} as Decision, importance 0.85-0.9. Then ${tools.associate} PREFERS_OVER any alternatives that came up.`,
    '',
    '3. Articulated pattern (user names it, you do not infer it).',
    '   Listen for: "I always do X", "every time", "this is how I usually", "my thing is".',
    `   -> ${tools.store} as Pattern, importance 0.8. Then ${tools.associate} EXEMPLIFIES concrete examples.`,
    '',
    'Storage ritual (every store runs all four steps):',
    `  (1) Pre-recall ${tools.recall} with a tight query, limit 5, to find the related memory.`,
    `  (2) ${tools.store} with type, importance, confidence, bare tags.`,
    `  (3) Verify with ${tools.recall} on a distinctive phrase from the content. Retry the store once if verify misses (known server quirk).`,
    `  (4) ${tools.associate} to the step-1 hit. Skip only if nothing plausible came back.`,
    '',
    `Prefer ${tools.update} over a duplicate store when a fact changes in place.`,
    `Valid relation types for ${tools.associate}: ${AUTHORABLE_RELATION_TYPES.join(', ')}.`,
    'Never store: session summaries, agent task-result dumps, attentiveness notes, speculative context, or confirmations ("great, that worked"). Memory is for future-you, not performance.',
    '',
    projectGateLine,
    '</automem-policy>',
  ].join('\n');
}

export function renderRelationTypesInline(): string {
  return AUTHORABLE_RELATION_TYPES.join(', ');
}

export function renderClaudeMdMemoryRules(params: PolicyTemplateOptions): string {
  const rules = AUTOMEM_RULES_POLICY_DEFAULTS;
  return [
    "# AutoMem Memory Rules for CLAUDE.md",
    "",
    `<!-- automem-template-version: ${params.templateVersion} -->`,
    "<!-- Generated by scripts/sync-memory-policy.ts. Do not edit by hand. -->",
    "",
    "Add this section to your `~/.claude/CLAUDE.md` file for Claude Code. The SessionStart hook will prompt memory recall automatically.",
    "",
    "For Claude Desktop, use Personal Preferences instead: copy the starter template from [`templates/CLAUDE_DESKTOP_INSTRUCTIONS.md`](CLAUDE_DESKTOP_INSTRUCTIONS.md).",
    "",
    "## Quick Installation",
    "",
    "```bash",
    "cat templates/CLAUDE_MD_MEMORY_RULES.md >> ~/.claude/CLAUDE.md",
    "```",
    "",
    "## Claude Code Memory Rules Template",
    "",
    "Add this to `~/.claude/CLAUDE.md`:",
    "",
    "````markdown",
    "<memory_rules>",
    "# AutoMem Memory Rules",
    "",
    "TOOL NAMING:",
    "- Claude Code exposes MCP tools as `mcp__<server>__<tool>` (e.g. `mcp__memory__recall_memory`).",
    "- These examples assume your server name is `memory`.",
    "- Claude Desktop uses the same tool-name shape, but its setup instructions live in `templates/CLAUDE_DESKTOP_INSTRUCTIONS.md` because Desktop preferences are semantic-first and not project-session-first.",
    "",
    "---",
    "",
    "## Tool's real behavior (validated against production corpus)",
    "",
    "- **Tags are a hard gate** — memories without a matching tag are excluded before scoring. Useful when you genuinely want a category (`preference`, `bugfix`); harmful when you're guessing a project slug.",
    "- **`auto_decompose: true` with template queries hurts focused recalls.** Sub-queries converge on the same top scorers, dedup strips them, residuals don't clear threshold. Keep it off by default; turn it on only for genuinely multi-topic questions.",
    "- **`limit` caps at 50.** Anything under 15 is throwing away context budget you have.",
    "- **Default `text` format shows content previews with created/updated timestamps and importance.** `detailed` adds type/confidence/metadata summary. Responses are budget-capped; fetch a full record with `recall_memory({ memory_id: \"<id>\" })`.",
    "- **Graph expansion can respect tag scope.** Use `expand_respect_tags: true` when `expand_relations: true` should stay inside the tag gate; leave it false or drop tags when you intentionally want broader graph context.",
    "- **`store_memory` can silently fail** (returns success, doesn't persist). After storing anything you care about, recall it back with a distinctive phrase to verify. Retry if gone.",
    "- **Bare tag convention** — `automem`, not `project/automem`. Older memories use `project/<slug>` prefixes, so tag-gated queries on slugs can miss historical content. When a gate returns sparse, retry without it. `entity:people:*`-style tags are server-injected — don't author them.",
    "",
    "### Slug-collision rule",
    "",
    "Bare project slugs must not collide with common topic words:",
    "- `streamdeck-mcp` ✓ — unique",
    "- `mcp-automem` ✓ — unique",
    "- `video` ✗ — collides with \"video content strategy\", \"video generation\" memories",
    "",
    "If a project's natural name is a common word, use a more specific slug (`video-gen-project`) or omit the tag gate for that project and rely on semantic query alone.",
    "",
    "### When to gate vs when NOT to",
    "",
    "| Intent | Use |",
    "|---|---|",
    "| Pull all memories of a stable well-tagged category | `tags: [<category>], limit: 20+` |",
    "| Scope to a project with a unique slug | `tags: [<slug>]` |",
    "| Discovery / debugging / pre-edit lookup | Semantic `query` only. Do NOT gate on topical tags. |",
    "",
    "Do not rely on `context_tags` as a boost right now. Known server quirks: literal string match with no prefix-index consultation, and small `limit` values can drop boosted results before ranking. Use generous `limit` + good semantic `query` instead.",
    "",
    "---",
    "",
    "## Session Start — Two-Phase Recall (1M-context params)",
    "",
    "Run these at session start (the `automem-session-start.sh` hook prompts you; actually execute the calls). The two recalls are independent — issue them in parallel in a single message. Opus 4.7's 1M context lets us use higher limits and a wider time window than the old defaults.",
    "",
    "**Phase 1 — Preferences** (tag-only, no time filter, no query):",
    "```",
    "mcp__memory__recall_memory({",
    "  tags: [\"preference\"],",
    `  limit: ${rules.preferenceRecallLimit},`,
    "  sort: \"updated_desc\"",
    "})",
    "```",
    "",
    "No query, no time gate. Sort by `updated_desc` so the freshest preferences win; results surface created/updated timestamps and importance inline so you can judge staleness at a glance.",
    "",
    "**Phase 2 — Task context** (single semantic query built from content nouns + project-slug gate + 90-day window):",
    "```",
    "mcp__memory__recall_memory({",
    "  query: \"<proper nouns, specific tools, exact topics from the user's message>\",",
    "  tags: [<project-slug>],",
    `  time_query: "last ${rules.contextRecallWindowDays} days",`,
    `  limit: ${rules.contextRecallLimit}`,
    "})",
    "```",
    "",
    "How to write the query:",
    "- Use the specific things named. \"AutoMem Discord bot Railway deploy\" beats \"current project status.\"",
    "- Proper nouns are gold — people, products, places.",
    "- Tools mentioned = include them (Railway, Vercel, pytest, etc.).",
    "- Skip meta words. \"Recent,\" \"decisions,\" \"corrections\" water down the embedding.",
    "- Code context: add `language: \"typescript\"` / `\"python\"` as a _ranker_ (boosts in-language memories, doesn't gate them).",
    "",
    "Gate by the working-directory-derived project slug when it's unambiguous (see slug-collision rule); drop the gate otherwise. **Use `queries[]` + `auto_decompose: true` only for genuinely multi-topic questions** — the empirical default is one good query.",
    "",
    "**On-demand debugging** (only when actively investigating a specific error symptom):",
    "```",
    "mcp__memory__recall_memory({",
    "  query: \"<error message or symptom>\",",
    `  limit: ${rules.debugRecallLimit}`,
    "})",
    "```",
    "",
    "No tag gate on debug recall — bugfix/solution tagging is incomplete and a hard gate hides cross-corpus fixes.",
    "",
    "Don't re-recall mid-conversation unless the topic genuinely shifts. With 1M context, memories pulled on turn 1 are still in scope — burning another recall on turn 4 of the same thread is waste.",
    "",
    "**Validated tradeoffs** (tested on production corpus of ~9,400 memories):",
    "- `limit 10→30` and `time_query \"last 30 days\"→\"last 90 days\"` compound: 2.5× useful results with zero score-quality loss.",
    "- Single-query Phase 2 consistently beats `queries[]` + `auto_decompose` on focused tasks.",
    "- `expand_relations`: no-op on the current sparse-association corpus. Revisit after association authoring discipline is established.",
    "",
    "---",
    "",
    "## MCP Tools Available",
    "",
    "- `store_memory` — save content with tags, importance (0.0–1.0), type, metadata, optional `t_valid` / `t_invalid`. Supports **batch mode** via `memories: [...]` (≤500 items, no per-item `id`/`embedding`/`t_valid`/`t_invalid`).",
    "- `recall_memory` — three modes:",
    "  - **ID fetch:** `memory_id` (ignores other params)",
    "  - **Tag enumeration:** `tags` + `exhaustive: true` (paginated, exact-match, returns `has_more`)",
    "  - **Ranked retrieval (default):** hybrid search; supports `exclude_tags`, `state_mode`, `recency_bias`, `scope_fallback`, `expand_respect_tags`, `min_score`, `adaptive_floor`, and diagnostics (`tag_scope`, `score_filter`, `query_time_ms`, `vector_search`, `outside_tag_scope`, `state_replaces`)",
    "- `associate_memories` — create typed relationships between memories; supports **batch mode** via `associations: [...]` (≤500) and relation-specific props like `reason`, `context`, `resolution`, `observations`, `transformation`, and `role`",
    "- `update_memory` — modify existing memories without duplication",
    "- `delete_memory` — remove by ID, or **bulk-by-tag** with `tags: [...]` (exact, case-insensitive, no dry-run)",
    "- `check_database_health` — FalkorDB + Qdrant status, including degraded state, sync counts, vector dimensions, and enrichment diagnostics when provided",
    "",
    "### Memory schema",
    "",
    "- `importance`: 0.9–1.0 (critical), 0.7–0.8 (important), 0.5–0.6 (standard), <0.5 (minor)",
    "- `confidence`: separate dial — 0.95 user-stated, 0.8 observed pattern, 0.6 tentative inference. Don't default everything to 0.95; it flattens the signal decay uses to identify noise.",
    "- `type`: `Decision` | `Pattern` | `Preference` | `Style` | `Habit` | `Insight` | `Context`",
    "- `tags`: array of bare strings — see convention above",
    "",
    "### Content size",
    "",
    "- Target 150–300 chars. One paragraph. \"Title. Context. Outcome.\"",
    "- Soft limit 500 chars (server auto-summarizes beyond).",
    "- Hard limit 2000 chars (rejected).",
    "- For more detail: split into atomic memories + associate.",
    "- Put structured data in `metadata`, not `content`.",
    "",
    "---",
    "",
    "## Storage Discipline",
    "",
    "Every `store_memory` call MUST set `type` and use bare conventional tags.",
    "",
    "### Required tags",
    "- One category when applicable: `preference` | `decision` | `pattern` | `bugfix` | `solution` | `milestone` | `deployment` | `build` | `test`.",
    "- Project slug (bare) when project-specific. Omit if too generic (slug-collision rule).",
    "",
    "### Storage patterns",
    "",
    "User preference (importance 0.9, confidence 0.95):",
    "```",
    "store_memory({",
    "  content: \"User preference: [exact quote or paraphrase]. Applies when: [context]\",",
    "  type: \"Preference\",",
    "  tags: [\"preference\", <scope>],",
    "  importance: 0.9,",
    "  confidence: 0.95",
    "})",
    "```",
    "",
    "Architectural decision (importance 0.9, confidence 0.9):",
    "```",
    "store_memory({",
    "  content: \"Decided [choice] because [rationale]. Alternatives: [X, Y]\",",
    "  type: \"Decision\",",
    "  tags: [\"decision\", <slug>],",
    "  importance: 0.9,",
    "  confidence: 0.9",
    "})",
    "```",
    "",
    "Bug fix (importance 0.75, confidence 0.85):",
    "```",
    "store_memory({",
    "  content: \"Fixed [issue] in [project]: [solution]. Root cause: [analysis]\",",
    "  type: \"Insight\",",
    "  tags: [\"bugfix\", \"solution\", <slug>],",
    "  importance: 0.75,",
    "  confidence: 0.85",
    "})",
    "```",
    "",
    "Feature implementation (importance 0.8, confidence 0.8):",
    "```",
    "store_memory({",
    "  content: \"Implemented [feature] using [approach]\",",
    "  type: \"Pattern\",",
    "  tags: [\"pattern\", \"feature\", <slug>],",
    "  importance: 0.8,",
    "  confidence: 0.8",
    "})",
    "```",
    "",
    "---",
    "",
    "## Mid-conversation memory ops — the three triggers, and only three",
    "",
    "Most memory systems fail here. Guidance that only lists what _counts_ as a correction or a decision, without telling you how to notice one fired mid-turn, results in stores piling up at session end (the session-summary dump pattern) or not happening at all. The fix is to listen for specific trigger phrases and treat store-and-associate as a single atomic ritual, not two separate thoughts.",
    "",
    "**1. User correction or override.**",
    "Listen for: \"actually,\" \"no, I prefer,\" \"not X, Y,\" \"that's wrong,\" \"stop doing X,\" \"never do X,\" \"I told you before,\" \"we decided X already,\" \"you keep doing Y.\"",
    "Store as `Preference`, importance 0.9, confidence 0.95, tags include `correction`. Store this turn — not queued for later.",
    "",
    "**2. Decision stabilizes after at least one round of discussion.**",
    "Listen for: \"let's go with X,\" \"yeah that's the plan,\" \"do it that way,\" \"ship it,\" \"final answer,\" \"okay let's do that.\" Signal: the decision survived a round of pushback. One-turn ideas don't qualify — they haven't stabilized.",
    "Store as `Decision`, importance 0.85–0.9. If alternatives came up, link with `PREFERS_OVER`.",
    "",
    "**3. Pattern articulated — not inferred.**",
    "Listen for: \"I always do X,\" \"every time,\" \"this is how I usually,\" \"my thing is,\" or you observing \"you tend to do X\" and the user confirming. Patterns get stored when they're _articulated_, not when you pattern-match silently.",
    "Store as `Pattern`, importance 0.8. Link to concrete examples with `EXEMPLIFIES`.",
    "",
    "### The atomic ritual — every store runs all four steps",
    "",
    "When a trigger fires, run this sequence inline in the same turn:",
    "",
    "```",
    "// Step 1: Recall to find what this relates to",
    "const related = recall_memory({",
    "  query: \"<what's being corrected / decided / named>\",",
    "  limit: 5",
    "})",
    "",
    "// Step 2: Store with type, importance, tags, non-default confidence",
    "const newId = store_memory({",
    "  content: \"Brief title. Context + reasoning. Outcome.\",",
    "  type: \"Preference\",  // or Decision / Pattern",
    "  tags: [\"correction\", <scope if any>],",
    "  importance: 0.9,",
    "  confidence: 0.95",
    "})",
    "",
    "// Step 3: Verify the store landed (silent-fail insurance)",
    "recall_memory({ query: \"<distinctive phrase from content>\", limit: 3 })",
    "// If not in results, retry the store once.",
    "",
    "// Step 4: Link to step 1's result if plausible",
    "if (related?.results?.length) {",
    "  associate_memories({",
    "    memory1_id: related.results[0].id,",
    "    memory2_id: newId,",
    "    type: \"INVALIDATED_BY\",  // or PREFERS_OVER / EXEMPLIFIES",
    "    strength: 0.9",
    "  })",
    "}",
    "```",
    "",
    "Step 4 is where the graph actually gets built. Skipping it is the #1 reason AutoMem degrades into a flat bag of notes.",
    "",
    "### Prefer `update_memory` over new-store-plus-invalidate",
    "",
    "When a fact changes — a price, a URL, a version, a name, a deployment state — update the existing memory in place. Use store + `INVALIDATED_BY` only when the old memory represents a genuinely different decision worth preserving for the record (\"we considered $15/mo before landing on $9/mo\" is archaeology; \"the dev URL changed\" is not).",
    "",
    "```",
    "update_memory({",
    "  memory_id: <existing id>,",
    "  content: <updated content>,",
    "  importance: 0.85  // optional — adjust if stakes changed",
    "})",
    "```",
    "",
    "### Mandatory association pairings",
    "",
    "| Trigger | Store | Then associate |",
    "|---|---|---|",
    "| User correction | `type: Preference`, importance 0.9 | Search old memory → `INVALIDATED_BY` (strength 0.9) |",
    "| Architectural decision | `type: Decision`, importance 0.9 | Find alternatives → `PREFERS_OVER` |",
    "| Bug fix | `type: Insight`, importance 0.75 | Link to bug report → `LEADS_TO` |",
    "| Pattern discovered | `type: Pattern`, importance 0.8 | Link to abstract concept → `EXEMPLIFIES` |",
    "| Knowledge evolved | `update_memory` old + store new | `EVOLVED_INTO` (old → new) |",
    "| Deprecated info | `update_memory` (importance 0.1, `metadata.deprecated: true`) | `INVALIDATED_BY` (old ← new) |",
    "",
    "Skip the association only if the related-memory search returns nothing plausible.",
    "",
    "### What NOT to store mid-conversation",
    "",
    "- **Session summaries.** Ever. \"End of session, here's what we accomplished\" is the pattern that creates most corpus garbage.",
    "- **Agent task result dumps.** Same family.",
    "- **\"Useful context that might matter later.\"** Speculative stores are noise. If unsure, skip.",
    "- **Things the user said they'll remember themselves** — calendar, plans, preferences about restaurants. That's journaling, not memory infrastructure.",
    "- **Confirmations.** \"Great, that worked\" doesn't need a memory. The decision that preceded it might.",
    "- **Anything stored to perform attentiveness.** Memory is for future-you, not for showing the user you were listening this turn.",
    "",
    "### Mid-conversation recall is rarer than you'd think",
    "",
    "With 1M context, turn-1 memories are still loaded on turn 15. Mid-conversation recall is only justified when:",
    "1. **Topic genuinely shifts.** New topic → new recall.",
    "2. **About to assert a specific technical claim and want to verify it's current.**",
    "3. **A proper noun you don't recognize enters the conversation.** Quick targeted recall on just that noun.",
    "",
    "Not justified: re-pulling general preferences, \"checking if there's anything else relevant,\" pre-emptive context gathering just in case.",
    "",
    "### Relationship types",
    "",
    "| Type | Use case |",
    "|---|---|",
    "| `LEADS_TO` | Bug → Solution, Problem → Fix |",
    "| `REINFORCES` | Supporting evidence, validation |",
    "| `CONTRADICTS` | Conflicting approaches |",
    "| `EVOLVED_INTO` | Knowledge progression, iterations |",
    "| `INVALIDATED_BY` | Outdated info → current approach |",
    "| `DERIVED_FROM` | Source relationships, origins |",
    "| `RELATES_TO` | General connections |",
    "| `PREFERS_OVER` | User / team preferences |",
    "| `EXEMPLIFIES` | Pattern examples |",
    "| `OCCURRED_BEFORE` | Temporal sequence |",
    "| `PART_OF` | Hierarchical structure |",
    "",
    "System/internal relations (`SIMILAR_TO`, `PRECEDED_BY`, `EXPLAINS`, `SHARES_THEME`, `PARALLEL_CONTEXT`, `DISCOVERED`) may appear in recall results but are NOT valid inputs to `associate_memories`.",
    "",
    "---",
    "",
    "## Temporal Validity",
    "",
    "For facts with a shelf life, set `t_valid` (ISO 8601 UTC, usually now) and `t_invalid` when known. These fields are persisted and queryable via `GET /memory/<id>`, though they don't always appear in `/recall` response envelopes.",
    "",
    "Use for: current deployment URL, active staging env, incident window, feature-flag rollout, ongoing PR, current sprint focus.",
    "",
    "```",
    "store_memory({",
    "  content: \"mcp-automem deployed to Railway at https://automem.up.railway.app\",",
    "  type: \"Context\", importance: 0.8,",
    "  tags: [\"deployment\", \"mcp-automem\", \"production\", \"railway\"],",
    "  t_valid: \"<ISO timestamp now>\",",
    "  t_invalid: \"<ISO timestamp +30 days>\"",
    "})",
    "```",
    "",
    "---",
    "",
    "## Lifecycle: Update > Duplicate",
    "",
    "- Before storing a new memory on a topic, do a recall. If a related memory exists, prefer `update_memory` or association over a new node.",
    "- `update_memory` on an old memory: bump `importance`, add to `content` (\"Updated: …\"), or mark deprecated via `metadata.deprecated: true` + low importance.",
    "- `delete_memory` only for true duplicates or credentials accidentally stored.",
    "",
    "### Known server quirk (workaround)",
    "",
    "A `store_memory` call can return success while failing to persist in rare cases. After storing anything you care about, do a quick recall with a content-specific query and verify. If not found, retry.",
    "",
    "---",
    "",
    "## Never Store",
    "",
    "- Secrets, credentials, API keys, private tokens.",
    "- Temporary build output, logs, debug dumps.",
    "- Large code blocks (store the pattern or decision instead).",
    "- Ephemeral state that changes every session.",
    "- Duplicate memories (recall first).",
    "</memory_rules>",
    "````",
    "",
  ].join('\n');
}
