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
    'PROJECT=$(basename "$PWD")',
    '',
    'cat << EOF',
    shellPrompt,
    'EOF',
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
    '- **`format: "detailed"`** exposes timestamps, confidence, importance, and relations so staleness is visible.',
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

  return [
    heading,
    '',
    params.desktop
      ? 'Desktop has no reliable project slug on most first turns, so prefer preferences plus one semantic task query. Add a tag gate only after the user clearly scopes to a project.'
      : `Standardized defaults: preferences limit ${AUTOMEM_RULES_POLICY_DEFAULTS.preferenceRecallLimit}, task-context limit ${AUTOMEM_RULES_POLICY_DEFAULTS.contextRecallLimit}, ${AUTOMEM_RULES_POLICY_DEFAULTS.contextRecallWindowDays}-day task window.`,
    '',
    'Preferences first:',
    '',
    '```javascript',
    `${recall}({`,
    '  tags: ["preference"],',
    `  limit: ${AUTOMEM_RULES_POLICY_DEFAULTS.preferenceRecallLimit},`,
    '  sort: "updated_desc",',
    '  format: "detailed"',
    '})',
    '```',
    '',
    'Task context: one semantic query built from proper nouns, products, files, error strings, tools, and specific topics in the user message.',
    '',
    '```javascript',
    `${recall}({`,
    '  query: "<proper nouns, product names, tools, specific topics from the user\'s message>",',
    `${projectTagLine}  time_query: "last ${AUTOMEM_RULES_POLICY_DEFAULTS.contextRecallWindowDays} days",`,
    `  limit: ${AUTOMEM_RULES_POLICY_DEFAULTS.contextRecallLimit},`,
    '  format: "detailed",',
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
    '  tags: ["bugfix", "solution"],',
    `  limit: ${AUTOMEM_RULES_POLICY_DEFAULTS.debugRecallLimit}`,
    '})',
    '```',
    '',
    "Don't re-recall mid-conversation unless the topic genuinely shifts, a new proper noun enters, or active debugging starts.",
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
    `await ${associate}({ memory1_id: related.results[0].id, memory2_id: stored.memory_id, type: "INVALIDATED_BY", strength: 0.9 })`,
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
    `- First substantive turn: run ${tools.recall} for preferences with tags ["preference"], limit ${preferenceLimit}, sort "updated_desc", format "detailed". Then run ONE semantic task-context recall using the user's real nouns, time_query "last ${windowDays} days", limit ${contextLimit}, format "detailed", and only use the project gate when it is unambiguous.`,
    `- Active debugging only: run ${tools.recall} with the error symptom, tags ["bugfix", "solution"], and limit ${debugLimit}.`,
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
