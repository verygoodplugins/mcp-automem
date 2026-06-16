import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';
import {
  AUTOMEM_POLICY_ASSOCIATION_MAPPINGS,
  AUTOMEM_POLICY_DEFAULTS,
  AUTOMEM_POLICY_PROFILES,
  AUTOMEM_PROVIDER_EXPLICIT_RECALL_LIMIT,
  AUTOMEM_STOP_NUDGE_MIN_HUMAN_TURNS,
  looksLikeExplicitRecallPrompt,
  renderClaudeDesktopInstructions,
  renderClaudeMdMemoryRules,
  renderCodexMemoryRules,
  renderCursorProjectRule,
  renderClaudeCodeSessionStartPrompt,
  renderClaudeCodeSessionStartHook,
  renderClaudeCodeStopNudgeHook,
  renderClaudeCodeStopNudgePrompt,
  renderClaudeCodeTrackStoreHook,
  renderHermesMemoryRules,
  renderHermesModeRules,
  renderHermesProviderPolicyPython,
  renderOpenClawPolicyContext,
  renderRelationTypesInline,
} from './memory-policy/shared.js';

const REPO_ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));

function readRepoFile(relativePath: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), 'utf8');
}

function readPackageVersion(): string {
  return JSON.parse(readRepoFile('package.json')).version;
}

function normalize(value: string): string {
  return value
    .replace(/[–—]/g, '-')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/\\`/g, '`')
    .replace(/\s+/g, ' ')
    .trim();
}

function expectFileEquals(relativePath: string, expected: string): void {
  const actual = readRepoFile(relativePath);
  expect(actual, `${relativePath} drifted from shared policy renderer`).toBe(expected);
}

function extractHeredocBody(fileContents: string): string {
  const match = fileContents.match(/cat << EOF\n([\s\S]*?)\nEOF/);
  if (!match) {
    throw new Error('Could not find heredoc body.');
  }
  return match[1];
}

function expectSharedPolicySurface(source: string) {
  const normalized = normalize(source);
  expect(normalized).toContain(`limit: ${AUTOMEM_POLICY_DEFAULTS.preferenceRecallLimit}`);
  expect(normalized).toContain(`limit: ${AUTOMEM_POLICY_DEFAULTS.contextRecallLimit}`);
  expect(normalized).toContain(`time_query: "last ${AUTOMEM_POLICY_DEFAULTS.contextRecallWindowDays} days"`);
  expect(normalized).toContain(`limit: ${AUTOMEM_POLICY_DEFAULTS.debugRecallLimit}`);
  expect(normalized).toContain('No tag gate on debug recall');
  expect(normalized).toContain('issue them in parallel');
  expect(normalized).not.toContain('format: "detailed"');
  expect(normalized).not.toContain('tags: ["bugfix", "solution"]');
  expect(normalized).toContain('topic genuinely shifts');
  expect(normalized).toContain('proper noun');
  expect(normalized).toContain('When recall misses');
  expect(normalized).toContain('expand_relations: true');
  expect(normalized).toContain('project/<slug>');
  expect(normalized).toContain('debug');
  expect(normalized).toContain('INVALIDATED_BY');
  expect(normalized).toContain('PREFERS_OVER');
  expect(normalized).toContain('EXEMPLIFIES');
  expect(normalized).toContain('update_memory');
  expect(normalized).toMatch(/correct/i);
  expect(normalized).toMatch(/decision stabil/i);
  expect(normalized).toMatch(/pattern/i);

  for (const mapping of AUTOMEM_POLICY_ASSOCIATION_MAPPINGS) {
    const [_, __, relation] = mapping.split(' -> ');
    expect(normalized).toContain(relation);
  }

  for (const relationType of renderRelationTypesInline().split(', ')) {
    expect(normalized).toContain(relationType);
  }
}

describe('shared AutoMem memory policy', () => {
  it('defines rules and provider recall profiles from one policy surface', () => {
    expect(AUTOMEM_POLICY_PROFILES.rules).toEqual({
      preferenceRecallLimit: 20,
      contextRecallLimit: 30,
      debugRecallLimit: 20,
      contextRecallWindowDays: 90,
    });
    expect(AUTOMEM_POLICY_PROFILES.provider).toEqual({
      preferenceRecallLimit: 5,
      contextRecallLimit: 10,
      debugRecallLimit: 10,
      contextRecallWindowDays: 90,
    });
    expect(AUTOMEM_POLICY_DEFAULTS).toBe(AUTOMEM_POLICY_PROFILES.rules);
    expect(AUTOMEM_PROVIDER_EXPLICIT_RECALL_LIMIT).toBe(10);
  });

  it('recognizes general opinion prompts as explicit recall prompts', () => {
    expect(looksLikeExplicitRecallPrompt('do we like Example Contact?')).toBe(true);
    expect(looksLikeExplicitRecallPrompt('how do we feel about Example Org?')).toBe(true);
    expect(looksLikeExplicitRecallPrompt('what do we think of Hermes provider mode?')).toBe(true);
  });

  it('renders the Claude Code session-start prompt from shared defaults', () => {
    expect(renderClaudeCodeSessionStartPrompt('$PROJECT')).toMatchInlineSnapshot(`
      "<automem_session_context>
      MEMORY RECALL - run both recalls before your first substantive response. They are independent: issue them in parallel in a single message.

      Phase 1 - Preferences (tag-only, no time filter, no query):
        recall_memory({
          tags: ["preference"],
          limit: 20,
          sort: "updated_desc"
        })

      Phase 2 - Task context (ONE semantic query from the user's actual nouns; project-slug gate when unambiguous; 90-day window):
        recall_memory({
          query: "<proper nouns, product names, people, tools, specific topics from the user's message>",
          tags: ["$PROJECT"],    // drop if slug collides with a common word
          time_query: "last 90 days",
          limit: 30
        })

      Project slug: $PROJECT

      During work - store durable memories when triggers fire:
      - Do not wait for a Stop hook or session end. When a durable correction, stabilized decision, articulated pattern, or root-cause insight appears, run recall -> store -> verify -> associate in that same turn.
      - Use type, importance, confidence, and bare tags on every store; verify by recalling a distinctive phrase; associate when a plausible related memory exists.
      - Skip storage for session summaries, progress notes, confirmations, temporary output, and speculative context.

      Notes:
      - Tags are a HARD GATE - they filter before scoring. Use only the tag sets above; never invent topic tags. Bare tags only - no namespace prefixes (\`project/*\`, \`lang/*\`).
      - Debugging recall is ON-DEMAND: when the user reports an error symptom, recall with the symptom as a semantic query and NO tags (a tag gate hides cross-corpus fixes), limit 20.
      - Phase 2 uses ONE targeted query, not \`queries[]\` + \`auto_decompose\`. Sub-queries converge and dedup drops results; reserve \`queries[]\` for genuinely multi-topic questions.
      - If the project slug collides with a common topic word (for example \`video\` or \`test\`), drop the Phase 2 tag gate and rely on semantic \`query\` alone.
      - Results show created/updated timestamps and importance - prefer fresh, high-importance memories. Fetch a single full record with recall_memory({ memory_id: "<id>" }) when needed.
      - Do not re-recall every turn. After turn 1, recall again only for topic shifts, new proper nouns, or active debugging.
      - If recall fails or returns nothing, continue without memory - do not mention the failure to the user.
      </automem_session_context>"
    `);
  });

  it('nudges Claude Code to store, verify, and associate during normal work', () => {
    const prompt = renderClaudeCodeSessionStartPrompt('$PROJECT');

    expect(prompt).toContain('During work - store durable memories when triggers fire');
    expect(prompt).toContain('Do not wait for a Stop hook or session end');
    expect(prompt).toContain('recall -> store -> verify -> associate');
    expect(prompt).toContain('associate when a plausible related memory exists');
  });

  it('renders the OpenClaw policy block from shared defaults', () => {
    expect(
      renderOpenClawPolicyContext({
        defaultTags: ['mcp-automem'],
      })
    ).toMatchInlineSnapshot(`
      "<automem-policy>
      Use AutoMem with the validated shared policy.

      Recall rules:
      - First substantive turn: run automem_recall_memory for preferences with tags ["preference"], limit 20, sort "updated_desc". In parallel, run ONE semantic task-context recall using the user's real nouns, time_query "last 90 days", limit 30, and only use the project gate when it is unambiguous.
      - Active debugging only: run automem_recall_memory with the error symptom as a semantic query, NO tags (a tag gate hides cross-corpus fixes), limit 20.
      - After turn 1, recall again only for topic shifts, new proper nouns, or active debugging. Do not re-recall on routine follow-ups.
      - If the user explicitly asks what you know about a person, project, or topic, run automem_recall_memory before answering from memory. Do not promise a "live recall" without doing it.

      Tag discipline for tool calls (tags are a hard gate, not a hint):
      - Valid tag sets for automem_recall_memory: ["preference"] or the project slug (e.g. ["mcp-automem"]). Otherwise drop tags and rely on the query.
      - Never invent topic-word tags from the prompt (e.g. ["voiceink", "autohub"]). Put those nouns in query, not tags.
      - Bare strings only. No namespace prefixes (project/*, lang/*), no platform tags (cursor, claude-code), no date-stamped tags.

      Mid-conversation stores fire the atomic ritual on exactly these three triggers. Listen for the trigger phrases; do not queue stores for session-end.

      1. User correction or override.
         Listen for: "actually", "no, I prefer", "not X, Y", "that's wrong", "stop doing X", "never do X", "I told you before", "we decided X already".
         -> automem_store_memory as Preference, importance 0.9, confidence 0.95, include "correction" in tags. Then automem_associate_memories INVALIDATED_BY the old memory (strength 0.9). Fire this turn, not later.

      2. Stabilized decision (survived at least one round of discussion).
         Listen for: "let's go with X", "yeah that's the plan", "ship it", "do it that way", "final answer", "okay let's do that".
         -> automem_store_memory as Decision, importance 0.85-0.9. Then automem_associate_memories PREFERS_OVER any alternatives that came up.

      3. Articulated pattern (user names it, you do not infer it).
         Listen for: "I always do X", "every time", "this is how I usually", "my thing is".
         -> automem_store_memory as Pattern, importance 0.8. Then automem_associate_memories EXEMPLIFIES concrete examples.

      Storage ritual (every store runs all four steps):
        (1) Pre-recall automem_recall_memory with a tight query, limit 5, to find the related memory.
        (2) automem_store_memory with type, importance, confidence, bare tags.
        (3) Verify with automem_recall_memory on a distinctive phrase from the content. Retry the store once if verify misses (known server quirk).
        (4) automem_associate_memories to the step-1 hit. Skip only if nothing plausible came back.

      Prefer automem_update_memory over a duplicate store when a fact changes in place.
      Valid relation types for automem_associate_memories: RELATES_TO, LEADS_TO, OCCURRED_BEFORE, PREFERS_OVER, EXEMPLIFIES, CONTRADICTS, REINFORCES, INVALIDATED_BY, EVOLVED_INTO, DERIVED_FROM, PART_OF.
      Never store: session summaries, agent task-result dumps, attentiveness notes, speculative context, or confirmations ("great, that worked"). Memory is for future-you, not performance.

      Project gate for first-turn task-context recall: mcp-automem
      </automem-policy>"
    `);
  });

  it('keeps the Claude Code session-start hook aligned with the shared renderer', () => {
    const hookContents = readRepoFile('templates/claude-code/hooks/automem-session-start.sh');
    expect(normalize(extractHeredocBody(hookContents))).toBe(
      normalize(renderClaudeCodeSessionStartPrompt('$PROJECT'))
    );
    expect(hookContents).toBe(renderClaudeCodeSessionStartHook());
  });

  it('embeds the storage-nudge prompt as JSON with the required hookEventName field', () => {
    const hook = renderClaudeCodeStopNudgeHook();
    // Claude Code rejects Stop-hook JSON whose hookSpecificOutput lacks
    // hookEventName — the exact bug that motivated this hook's design.
    expect(hook).toContain('"hookEventName":"%s"');
    // suppressOutput:true hides raw JSON stdout. The injected context itself
    // must stay factual so Claude Code can keep it hidden where supported and
    // so older Stop behavior has little user-visible text if surfaced.
    expect(hook).toContain('"suppressOutput":true');
    expect(hook).toContain(JSON.stringify(renderClaudeCodeStopNudgePrompt()));
  });

  it('gates the storage nudge to substantive sessions and keeps it neutral', () => {
    const hook = renderClaudeCodeStopNudgeHook();
    // The gate reads transcript_path from hook stdin and counts human prompts
    // (type:"user" entries that are neither tool results nor meta entries).
    expect(hook).toContain('transcript_path');
    expect(hook).toContain(`-lt ${AUTOMEM_STOP_NUDGE_MIN_HUMAN_TURNS}`);
    // Keep the prompt a single factual line: enough state for Claude, minimal
    // text if an older host still surfaces Stop context.
    const prompt = renderClaudeCodeStopNudgePrompt();
    expect(prompt).not.toContain('\n');
    expect(prompt).toContain('AutoMem status: no memory has been stored this session.');
    expect(prompt).toContain('Durable candidates: corrections');
    expect(prompt).toContain('Non-candidates: session summaries');
    expect(prompt).not.toMatch(/store it now/i);
    expect(prompt).not.toMatch(/reply with exactly/i);
    expect(prompt).toMatch(/session summaries/i);
  });

  it('keeps generated host rule artifacts exactly aligned with shared renderers', () => {
    const templateVersion = readPackageVersion();
    expectFileEquals('templates/claude-code/hooks/automem-session-start.sh', renderClaudeCodeSessionStartHook());
    expectFileEquals('plugins/automem/scripts/session-start.sh', renderClaudeCodeSessionStartHook());
    expectFileEquals('templates/claude-code/hooks/automem-stop-nudge.sh', renderClaudeCodeStopNudgeHook());
    expectFileEquals('plugins/automem/scripts/stop-nudge.sh', renderClaudeCodeStopNudgeHook());
    expectFileEquals('templates/claude-code/hooks/automem-track-store.sh', renderClaudeCodeTrackStoreHook());
    expectFileEquals('plugins/automem/scripts/track-store.sh', renderClaudeCodeTrackStoreHook());
    expectFileEquals(
      'templates/codex/memory-rules.md',
      renderCodexMemoryRules({ projectName: '{{PROJECT_NAME}}', templateVersion })
    );
    expectFileEquals(
      'templates/cursor/automem.mdc.template',
      renderCursorProjectRule({
        projectName: '{{PROJECT_NAME}}',
        mcpServerName: '{{MCP_SERVER_NAME}}',
        mcpToolPrefix: '{{MCP_TOOL_PREFIX}}',
        templateVersion,
      })
    );
    expectFileEquals(
      'templates/CLAUDE_DESKTOP_INSTRUCTIONS.md',
      renderClaudeDesktopInstructions({ templateVersion })
    );
    expectFileEquals(
      'templates/CLAUDE_MD_MEMORY_RULES.md',
      renderClaudeMdMemoryRules({ templateVersion })
    );
    expectFileEquals(
      'templates/hermes/memory-rules.md',
      renderHermesMemoryRules({
        projectName: '{{PROJECT_NAME}}',
        modeRules: '{{HERMES_MODE_RULES}}',
        templateVersion,
      })
    );
  });

  it('keeps the Cursor template aligned with the shared defaults', () => {
    expectSharedPolicySurface(readRepoFile('templates/cursor/automem.mdc.template'));
  });

  it('keeps the Claude Desktop instructions aligned with the shared defaults', () => {
    expectSharedPolicySurface(readRepoFile('templates/CLAUDE_DESKTOP_INSTRUCTIONS.md'));
  });

  it('keeps the Codex memory rules aligned with the shared defaults', () => {
    expectSharedPolicySurface(readRepoFile('templates/codex/memory-rules.md'));
  });

  it('keeps the Hermes provider template aligned with the provider profile', () => {
    const source = readRepoFile('templates/hermes/provider/automem_policy.py');
    expect(source).toBe(renderHermesProviderPolicyPython());
    expect(source).toContain('PREFERENCE_RECALL_LIMIT = 5');
    expect(source).toContain('CONTEXT_RECALL_LIMIT = 10');
    expect(source).toContain('DEBUG_RECALL_LIMIT = 10');
    expect(source).toContain('CONTEXT_RECALL_WINDOW_DAYS = 90');
    expect(source).toContain('MAX_EXPLICIT_RECALL_LIMIT = 10');
    expect(source).toContain('time_query');
    expect(source).toContain('updated_desc');
    expect(source).toContain('topic shift');
  });

  it('renders Hermes mode-specific rules from the shared policy surface', () => {
    expect(renderHermesModeRules('mcp')).toContain('mcp_automem_recall_memory');
    expect(renderHermesModeRules('provider')).toContain('automem_recall_memory');
    expect(renderHermesModeRules('both')).toContain('mcp_automem_recall_memory');
    expect(renderHermesModeRules('both')).not.toMatch(/`automem_recall_memory`/);
  });

  it('sync-memory-policy is idempotent for generated policy artifacts', () => {
    const generatedFiles = [
      'templates/claude-code/hooks/automem-session-start.sh',
      'plugins/automem/scripts/session-start.sh',
      'templates/claude-code/hooks/automem-stop-nudge.sh',
      'plugins/automem/scripts/stop-nudge.sh',
      'templates/claude-code/hooks/automem-track-store.sh',
      'plugins/automem/scripts/track-store.sh',
      'templates/codex/memory-rules.md',
      'templates/cursor/automem.mdc.template',
      'templates/CLAUDE_DESKTOP_INSTRUCTIONS.md',
      'templates/CLAUDE_MD_MEMORY_RULES.md',
      'templates/hermes/memory-rules.md',
      'templates/hermes/provider/automem_policy.py',
    ];
    const before = new Map(generatedFiles.map((file) => [file, readRepoFile(file)]));
    const tsx = path.join(REPO_ROOT, 'node_modules', '.bin', process.platform === 'win32' ? 'tsx.cmd' : 'tsx');

    execFileSync(tsx, ['scripts/sync-memory-policy.ts'], { cwd: REPO_ROOT, stdio: 'pipe' });
    execFileSync(tsx, ['scripts/sync-memory-policy.ts'], { cwd: REPO_ROOT, stdio: 'pipe' });

    for (const file of generatedFiles) {
      expect(readRepoFile(file), `${file} changed after idempotent sync`).toBe(before.get(file));
    }
  });
});
