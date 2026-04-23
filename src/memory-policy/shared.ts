import { AUTHORABLE_RELATION_TYPES } from '../types.js';

export const AUTOMEM_POLICY_DEFAULTS = {
  preferenceRecallLimit: 20,
  contextRecallLimit: 30,
  debugRecallLimit: 20,
  contextRecallWindowDays: 90,
} as const;

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

const AMBIGUOUS_PROJECT_TAGS = new Set(['api', 'app', 'test', 'video']);
const CASUAL_OPENING_PATTERN =
  /^(hi|hello|hey|yo|sup|thanks|thank you|ok|okay|cool|nice|great|ping|test|who are you)\b/i;
const DEBUG_PROMPT_PATTERN =
  /(error|exception|traceback|stack trace|stacktrace|failing|fails|failed|failure|bug|regression|crash|broken|debug|investigat|not work|doesn't work|does not work|cannot|can't|fix)/i;
const EXPLICIT_RECALL_PROMPT_PATTERN =
  /(what do (you|we) (have|know) about|tell me about|who is|who's|do you remember|remember|recall|search memory|check memory|look in memory|have we spoken about|what do you have on)/i;

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
  return AMBIGUOUS_PROJECT_TAGS.has(normalizeProjectTag(tag));
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
    'MEMORY RECALL - run these phases in order before your first substantive response.',
    '',
    'Phase 1 - Preferences (tag-only, no time filter, no query):',
    '  mcp__memory__recall_memory({',
    '    tags: ["preference"],',
    `    limit: ${AUTOMEM_POLICY_DEFAULTS.preferenceRecallLimit},`,
    '    sort: "updated_desc",',
    '    format: "detailed"',
    '  })',
    '',
    'Phase 2 - Task context (ONE semantic query from the user\'s actual nouns; project-slug gate when unambiguous; 90-day window):',
    '  mcp__memory__recall_memory({',
    '    query: "<proper nouns, product names, tools, specific topics from the user\'s message>",',
    `    tags: ["${projectExpression}"],    // drop if slug collides with a common word`,
    `    time_query: "last ${AUTOMEM_POLICY_DEFAULTS.contextRecallWindowDays} days",`,
    `    limit: ${AUTOMEM_POLICY_DEFAULTS.contextRecallLimit},`,
    '    format: "detailed"',
    '  })',
    '',
    'Phase 3 - ON-DEMAND debugging (only if the user\'s message is a debugging/error-symptom question; skip otherwise):',
    '  mcp__memory__recall_memory({',
    '    query: "<error symptom>",',
    '    tags: ["bugfix", "solution"],',
    `    limit: ${AUTOMEM_POLICY_DEFAULTS.debugRecallLimit}`,
    '  })',
    '',
    `Project slug: ${projectExpression}`,
    '',
    'Notes:',
    '- Tags are a HARD GATE - they filter before scoring. For discovery/debugging across the full corpus, drop `tags` and rely on semantic `query` alone.',
    '- Do NOT use namespace-prefixed tags (`project/*`, `lang/*`, etc.) - the corpus uses bare tags.',
    '- Phase 2 uses ONE targeted query, not `queries[]` + `auto_decompose`. Sub-queries converge and dedup drops results; a single query built from the real nouns in the user\'s message wins empirically. Only switch to `queries[]` for genuinely multi-topic questions.',
    '- If the project slug collides with a common topic word (for example `video` or `test`), drop the Phase 2 tag gate and rely on semantic `query` alone.',
    '- Do not re-recall every turn. After turn 1, recall again only for topic shifts, new proper nouns, or active debugging.',
    '- If recall fails or returns nothing, continue without memory - do not mention the failure to the user.',
    '</automem_session_context>',
  ].join('\n');
}

export function renderOpenClawPolicyContext(params: {
  defaultTags: string[];
  tools?: Partial<ToolNames>;
}): string {
  const tools: ToolNames = {
    recall: params.tools?.recall || 'automem_recall_memory',
    store: params.tools?.store || 'automem_store_memory',
    update: params.tools?.update || 'automem_update_memory',
    associate: params.tools?.associate || 'automem_associate_memories',
  };
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
    `- First substantive turn: run ${tools.recall} for preferences with tags ["preference"], limit ${AUTOMEM_POLICY_DEFAULTS.preferenceRecallLimit}, sort "updated_desc", format "detailed". Then run ONE semantic task-context recall using the user\'s real nouns, time_query "last ${AUTOMEM_POLICY_DEFAULTS.contextRecallWindowDays} days", limit ${AUTOMEM_POLICY_DEFAULTS.contextRecallLimit}, format "detailed", and only use the project gate when it is unambiguous.`,
    `- Active debugging only: run ${tools.recall} with the error symptom, tags ["bugfix", "solution"], and limit ${AUTOMEM_POLICY_DEFAULTS.debugRecallLimit}.`,
    '- After turn 1, recall again only for topic shifts, new proper nouns, or active debugging. Do not re-recall on routine follow-ups.',
    `- If the user explicitly asks what you know about a person, project, or topic, run ${tools.recall} before answering from memory. Do not promise a "live recall" without doing it.`,
    '',
    'Tag discipline for tool calls (tags are a hard gate, not a hint):',
    `- Valid tag sets for ${tools.recall}: ["preference"], ["bugfix", "solution"], or the project slug (e.g. [${projectSlugHint}]). Otherwise drop tags and rely on the query.`,
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
