import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';
import {
  AUTOMEM_POLICY_ASSOCIATION_MAPPINGS,
  AUTOMEM_POLICY_DEFAULTS,
  renderClaudeCodeSessionStartPrompt,
  renderOpenClawPolicyContext,
  renderRelationTypesInline,
} from './memory-policy/shared.js';

const REPO_ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));

function readRepoFile(relativePath: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), 'utf8');
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
  expect(normalized).toContain(`tags: ["bugfix", "solution"]`);
  expect(normalized).toContain(`limit: ${AUTOMEM_POLICY_DEFAULTS.debugRecallLimit}`);
  expect(normalized).toContain('topic genuinely shifts');
  expect(normalized).toContain('proper noun');
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
  it('renders the Claude Code session-start prompt from shared defaults', () => {
    expect(renderClaudeCodeSessionStartPrompt('$PROJECT')).toMatchInlineSnapshot(`
      "<automem_session_context>
      MEMORY RECALL - run these phases in order before your first substantive response.
      
      Phase 1 - Preferences (tag-only, no time filter, no query):
        mcp__memory__recall_memory({
          tags: ["preference"],
          limit: 20,
          sort: "updated_desc",
          format: "detailed"
        })
      
      Phase 2 - Task context (ONE semantic query from the user's actual nouns; project-slug gate when unambiguous; 90-day window):
        mcp__memory__recall_memory({
          query: "<proper nouns, product names, tools, specific topics from the user's message>",
          tags: ["$PROJECT"],    // drop if slug collides with a common word
          time_query: "last 90 days",
          limit: 30,
          format: "detailed"
        })
      
      Phase 3 - ON-DEMAND debugging (only if the user's message is a debugging/error-symptom question; skip otherwise):
        mcp__memory__recall_memory({
          query: "<error symptom>",
          tags: ["bugfix", "solution"],
          limit: 20
        })
      
      Project slug: $PROJECT
      
      Notes:
      - Tags are a HARD GATE - they filter before scoring. For discovery/debugging across the full corpus, drop \`tags\` and rely on semantic \`query\` alone.
      - Do NOT use namespace-prefixed tags (\`project/*\`, \`lang/*\`, etc.) - the corpus uses bare tags.
      - Phase 2 uses ONE targeted query, not \`queries[]\` + \`auto_decompose\`. Sub-queries converge and dedup drops results; a single query built from the real nouns in the user's message wins empirically. Only switch to \`queries[]\` for genuinely multi-topic questions.
      - If the project slug collides with a common topic word (for example \`video\` or \`test\`), drop the Phase 2 tag gate and rely on semantic \`query\` alone.
      - Do not re-recall every turn. After turn 1, recall again only for topic shifts, new proper nouns, or active debugging.
      - If recall fails or returns nothing, continue without memory - do not mention the failure to the user.
      </automem_session_context>"
    `);
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
      - First substantive turn: run automem_recall_memory for preferences with tags ["preference"], limit 20, sort "updated_desc", format "detailed". Then run ONE semantic task-context recall using the user's real nouns, time_query "last 90 days", limit 30, format "detailed", and only use the project gate when it is unambiguous.
      - Active debugging only: run automem_recall_memory with the error symptom, tags ["bugfix", "solution"], and limit 20.
      - After turn 1, recall again only for topic shifts, new proper nouns, or active debugging. Do not re-recall on routine follow-ups.
      - If the user explicitly asks what you know about a person, project, or topic, run automem_recall_memory before answering from memory. Do not promise a "live recall" without doing it.

      Tag discipline for tool calls (tags are a hard gate, not a hint):
      - Valid tag sets for automem_recall_memory: ["preference"], ["bugfix", "solution"], or the project slug (e.g. ["mcp-automem"]). Otherwise drop tags and rely on the query.
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
});
