import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import openClawPlugin, {
  isLikelyStartupTurn,
  resetOpenClawSessionStateForTests,
} from './openclaw-plugin.js';
import {
  buildOpenClawStartupContext,
  looksLikeOpenClawProfileCue,
} from './openclaw-startup-profile.js';

const mockFetch = vi.fn();

function jsonResponse(payload: unknown) {
  return {
    ok: true,
    json: async () => payload,
  } as Response;
}

function registerBeforePromptHandler(params?: {
  config?: unknown;
  pluginConfig?: Record<string, unknown>;
}) {
  const handlers: Array<
    (event: { prompt: string; messages: unknown[] }, ctx: { sessionKey?: string }) => Promise<{ prependSystemContext?: string } | void>
  > = [];

  openClawPlugin.register({
    config: params?.config,
    pluginConfig: {
      endpoint: 'http://localhost:8001',
      autoRecall: true,
      exposure: 'dm-only',
      ...(params?.pluginConfig || {}),
    },
    logger: { warn: vi.fn() },
    registerTool: vi.fn(),
    on: (_hookName, handler) => {
      handlers.push(handler);
    },
  });

  expect(handlers).toHaveLength(1);
  return handlers[0];
}

function getRequestUrl(callIndex: number): URL {
  return new URL(String(mockFetch.mock.calls[callIndex]?.[0]));
}

describe('openclaw AutoMem plugin', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch);
    vi.clearAllMocks();
    resetOpenClawSessionStateForTests();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetAllMocks();
  });

  it('recognizes likely startup turns', () => {
    expect(isLikelyStartupTurn([])).toBe(true);
    expect(isLikelyStartupTurn([{}])).toBe(true);
    expect(isLikelyStartupTurn([{}, {}])).toBe(false);
  });

  describe('extended schemas (parity with v0.15.2)', () => {
    function captureRegisteredTools(pluginConfig?: Record<string, unknown>) {
      const tools: Array<{
        name: string;
        execute: (id: string, params: unknown) => Promise<unknown>;
        parameters: any;
      }> = [];
      openClawPlugin.register({
        pluginConfig: {
          endpoint: 'http://localhost:8001',
          autoRecall: false,
          ...(pluginConfig || {}),
        },
        logger: { warn: vi.fn() },
        registerTool: (tool) => {
          tools.push({
            name: tool.name,
            execute: tool.execute,
            parameters: tool.parameters,
          });
        },
        on: () => {},
      });
      return tools;
    }

    it('exposes new params on recall, store, delete schemas', () => {
      const tools = captureRegisteredTools();
      const recall = tools.find((t) => t.name === 'automem_recall_memory');
      const store = tools.find((t) => t.name === 'automem_store_memory');
      const del = tools.find((t) => t.name === 'automem_delete_memory');
      expect(recall?.parameters?.properties?.memory_id).toBeDefined();
      expect(recall?.parameters?.properties?.exhaustive).toBeDefined();
      expect(recall?.parameters?.properties?.exclude_tags).toBeDefined();
      expect(store?.parameters?.properties?.memories).toBeDefined();
      expect(store?.parameters?.properties?.memories?.maxItems).toBe(500);
      expect(del?.parameters?.properties?.tags).toBeDefined();
      expect(del?.parameters?.required).toBeUndefined();
    });

    it('keeps the surface at six tools (no new tool registrations)', () => {
      const tools = captureRegisteredTools();
      expect(tools.map((t) => t.name).sort()).toEqual([
        'automem_associate_memories',
        'automem_check_health',
        'automem_delete_memory',
        'automem_recall_memory',
        'automem_store_memory',
        'automem_update_memory',
      ]);
    });

    it('applies mergeTags per item in batch store mode', async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ stored: 2, memory_ids: ['m1', 'm2'], status: 'success' })
      );

      const tools = captureRegisteredTools({ defaultTags: ['mcp-automem'] });
      const store = tools.find((t) => t.name === 'automem_store_memory')!;

      await store.execute('call-1', {
        memories: [
          { content: 'one', tags: ['extra'] },
          { content: 'two' },
        ],
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1]?.body as string);
      expect(body.memories).toHaveLength(2);
      expect(body.memories[0].tags).toEqual(['mcp-automem', 'extra']);
      expect(body.memories[1].tags).toEqual(['mcp-automem']);
    });

    it('does not inject defaultTags on bulk-delete-by-tag', async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ status: 'success', tags: ['x'], deleted_count: 1 })
      );

      const tools = captureRegisteredTools({ defaultTags: ['mcp-automem'] });
      const del = tools.find((t) => t.name === 'automem_delete_memory')!;

      await del.execute('call-1', { tags: ['x'] });

      const url = getRequestUrl(0);
      expect(url.pathname).toBe('/memory/by-tag');
      const tagParams = url.searchParams.getAll('tags');
      expect(tagParams).toEqual(['x']);
      expect(tagParams).not.toContain('mcp-automem');
    });

    it('routes recall_memory({memory_id}) to GET /memory/{id}', async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ status: 'success', memory: { id: 'mem-x', content: 'hi' } })
      );

      const tools = captureRegisteredTools();
      const recall = tools.find((t) => t.name === 'automem_recall_memory')!;

      await recall.execute('call-1', { memory_id: 'mem-x' });

      const url = getRequestUrl(0);
      expect(url.pathname).toBe('/memory/mem-x');
    });
  });

  it('detects profile-like memories', () => {
    expect(
      looksLikeOpenClawProfileCue({
        memory: {
          content: 'Call me Jack. Timezone Berlin.',
          tags: ['identity'],
        },
      })
    ).toBe(true);

    expect(
      looksLikeOpenClawProfileCue({
        memory: {
          content: 'Shipped the TypeScript refactor.',
          tags: ['release'],
        },
      })
    ).toBe(false);
  });

  it('builds generic startup guidance when no profile cue is present', () => {
    const context = buildOpenClawStartupContext({
      startupResults: [
        {
          memory: {
            content: 'Recent work on plugin install flow.',
            tags: ['openclaw'],
          },
        },
      ],
    });

    expect(context).toContain('Do not run a bootstrap questionnaire');
    expect(context).toContain('Use a generic greeting');
  });

  it('performs startup recall on first turn when bootstrap is skipped', async () => {
    const handler = registerBeforePromptHandler({
      config: {
        agents: {
          defaults: {
            skipBootstrap: true,
          },
        },
      },
      pluginConfig: {
        defaultTags: ['mcp-automem'],
        startupProfile: '- [Preference] Call me Jack. Keep it sharp and direct. [tags: profile]',
      },
    });

    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        results: [
          {
            id: 'mem-profile',
            memory: {
              content: 'Call me Jack. Timezone Berlin. Keep it sharp and direct.',
              tags: ['profile', 'identity'],
              type: 'Preference',
            },
          },
        ],
        count: 1,
      })
    );

    const result = await handler(
      {
        prompt: 'hi',
        messages: [{ role: 'user', content: 'hi' }],
      },
      {}
    );

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(getRequestUrl(0).searchParams.get('limit')).toBe('20');
    expect(result?.prependSystemContext).toContain('<automem-policy>');
    expect(result?.prependSystemContext).toContain('<automem-startup>');
    expect(result?.prependSystemContext).toContain('Cached startup profile');
    expect(result?.prependSystemContext).toContain('Call me Jack');
    expect(result?.prependSystemContext).not.toContain('<relevant-memories>');
  });

  it('recalls preferences and first-turn context using the project gate when unambiguous', async () => {
    const handler = registerBeforePromptHandler({
      pluginConfig: {
        defaultTags: ['mcp-automem'],
      },
    });

    mockFetch
      .mockResolvedValueOnce(
        jsonResponse({
          results: [
            {
              id: 'pref-1',
              memory: {
                content: 'User prefers concise replies.',
                tags: ['preference'],
                type: 'Preference',
              },
            },
          ],
          count: 1,
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          results: [
            {
              id: 'ctx-1',
              memory: {
                content: 'Railway deploy work for mcp-automem.',
                tags: ['mcp-automem'],
                type: 'Context',
              },
            },
          ],
          count: 1,
        })
      );

    const result = await handler(
      {
        prompt: 'Finish the Railway deploy flow for mcp-automem',
        messages: [{ role: 'user', content: 'Finish the Railway deploy flow for mcp-automem' }],
      },
      {}
    );

    expect(mockFetch).toHaveBeenCalledTimes(2);

    const preferenceUrl = getRequestUrl(0);
    expect(preferenceUrl.searchParams.getAll('tags')).toEqual(['preference']);
    expect(preferenceUrl.searchParams.get('limit')).toBe('20');
    expect(preferenceUrl.searchParams.get('sort')).toBe('updated_desc');
    expect(preferenceUrl.searchParams.get('format')).toBe('detailed');

    const contextUrl = getRequestUrl(1);
    expect(contextUrl.searchParams.get('query')).toBe('Finish the Railway deploy flow for mcp-automem');
    expect(contextUrl.searchParams.getAll('tags')).toEqual(['mcp-automem']);
    expect(contextUrl.searchParams.get('time_query')).toBe('last 90 days');
    expect(contextUrl.searchParams.get('limit')).toBe('30');
    expect(contextUrl.searchParams.get('format')).toBe('detailed');

    expect(result?.prependSystemContext).toContain('<automem-policy>');
    expect(result?.prependSystemContext).toContain('<relevant-memories>');
    expect(result?.prependSystemContext).toContain('INVALIDATED_BY');
    expect(result?.prependSystemContext).toContain('PREFERS_OVER');
    expect(result?.prependSystemContext).toContain('EXEMPLIFIES');
    expect(result?.prependSystemContext).toContain('automem_update_memory');
  });

  it('falls back to semantic-only context recall when default tags are ambiguous', async () => {
    const handler = registerBeforePromptHandler({
      pluginConfig: {
        defaultTags: ['video'],
      },
    });

    mockFetch
      .mockResolvedValueOnce(jsonResponse({ results: [], count: 0 }))
      .mockResolvedValueOnce(jsonResponse({ results: [], count: 0 }));

    await handler(
      {
        prompt: 'Plan the video onboarding launch',
        messages: [{ role: 'user', content: 'Plan the video onboarding launch' }],
      },
      {}
    );

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(getRequestUrl(1).searchParams.getAll('tags')).toEqual([]);
  });

  it('does not auto-recall on ordinary follow-up turns', async () => {
    const handler = registerBeforePromptHandler({
      pluginConfig: {
        defaultTags: ['mcp-automem'],
      },
    });

    const result = await handler(
      {
        prompt: 'Ship the next docs update',
        messages: [{ role: 'user' }, { role: 'assistant' }],
      },
      {}
    );

    expect(mockFetch).not.toHaveBeenCalled();
    expect(result?.prependSystemContext).toContain('<automem-policy>');
    expect(result?.prependSystemContext).not.toContain('<relevant-memories>');
  });

  it('returns policy via prependSystemContext when exposure is off', async () => {
    const handler = registerBeforePromptHandler({
      pluginConfig: {
        defaultTags: ['mcp-automem'],
        exposure: 'off',
      },
    });

    const result = (await handler(
      {
        prompt: 'Hey, starting fresh in mcp-automem',
        messages: [{ role: 'user', content: 'Hey, starting fresh in mcp-automem' }],
      },
      {}
    )) as Record<string, unknown> | undefined;

    expect(mockFetch).not.toHaveBeenCalled();
    expect(result?.prependSystemContext).toContain('<automem-policy>');
    expect(result).not.toHaveProperty('prependContext');
  });

  it('returns policy via prependSystemContext on channel/group sessionKeys (dm-only exposure)', async () => {
    const handler = registerBeforePromptHandler({
      pluginConfig: {
        defaultTags: ['mcp-automem'],
      },
    });

    const result = (await handler(
      {
        prompt: 'team update on mcp-automem',
        messages: [{ role: 'user', content: 'team update on mcp-automem' }],
      },
      { sessionKey: 'slack:group:eng-automation:channel:general' }
    )) as Record<string, unknown> | undefined;

    expect(mockFetch).not.toHaveBeenCalled();
    expect(result?.prependSystemContext).toContain('<automem-policy>');
    expect(result).not.toHaveProperty('prependContext');
  });

  it('returns policy via prependSystemContext on hook: sessions (dm-only exposure)', async () => {
    const handler = registerBeforePromptHandler({
      pluginConfig: {
        defaultTags: ['mcp-automem'],
      },
    });

    const result = (await handler(
      {
        prompt: 'post-commit capture',
        messages: [{ role: 'user', content: 'post-commit capture' }],
      },
      { sessionKey: 'hook:post-commit' }
    )) as Record<string, unknown> | undefined;

    expect(mockFetch).not.toHaveBeenCalled();
    expect(result?.prependSystemContext).toContain('<automem-policy>');
    expect(result).not.toHaveProperty('prependContext');
  });

  it('runs semantic recall on explicit mid-conversation memory probes', async () => {
    const handler = registerBeforePromptHandler({
      pluginConfig: {
        defaultTags: ['mcp-automem'],
      },
    });

    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        results: [
          {
            id: 'person-1',
            memory: {
              content: 'Sonya helped with the Hermes rollout.',
              tags: ['people'],
              type: 'Context',
            },
          },
        ],
        count: 1,
      })
    );

    const result = await handler(
      {
        prompt: 'What do you have on Sonya?',
        messages: [{ role: 'user' }, { role: 'assistant' }],
      },
      { sessionKey: 'dm:test' }
    );

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const recallUrl = getRequestUrl(0);
    expect(recallUrl.searchParams.get('query')).toBe('What do you have on Sonya?');
    expect(recallUrl.searchParams.getAll('tags')).toEqual([]);
    expect(recallUrl.searchParams.get('time_query')).toBe('last 90 days');
    expect(result?.prependSystemContext).toContain('<relevant-memories>');
  });

  it('runs semantic recall on later turns when a new named entity appears', async () => {
    const handler = registerBeforePromptHandler({
      pluginConfig: {
        defaultTags: ['mcp-automem'],
      },
    });

    const initialResult = await handler(
      {
        prompt: 'continue the installer work',
        messages: [{ role: 'user' }, { role: 'assistant' }],
      },
      { sessionKey: 'dm:test' }
    );

    expect(mockFetch).not.toHaveBeenCalled();
    expect(initialResult?.prependSystemContext).not.toContain('<relevant-memories>');

    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        results: [
          {
            id: 'entity-1',
            memory: {
              content: 'Hermes is the next client integration target.',
              tags: ['planning'],
              type: 'Decision',
            },
          },
        ],
        count: 1,
      })
    );

    const nextResult = await handler(
      {
        prompt: 'What do you think about doing this with Hermes next?',
        messages: [{ role: 'user' }, { role: 'assistant' }],
      },
      { sessionKey: 'dm:test' }
    );

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const recallUrl = getRequestUrl(0);
    expect(recallUrl.searchParams.get('query')).toBe('What do you think about doing this with Hermes next?');
    expect(recallUrl.searchParams.getAll('tags')).toEqual([]);
    expect(nextResult?.prependSystemContext).toContain('<relevant-memories>');
  });

  it('runs debug recall on later error-investigation turns', async () => {
    const handler = registerBeforePromptHandler({
      pluginConfig: {
        defaultTags: ['mcp-automem'],
      },
    });

    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        results: [
          {
            id: 'bug-1',
            memory: {
              content: 'Fixed the Railway deploy traceback by resetting the plugin source.',
              tags: ['bugfix', 'solution'],
              type: 'Insight',
            },
          },
        ],
        count: 1,
      })
    );

    const result = await handler(
      {
        prompt: 'I am debugging a traceback in the Railway deploy flow',
        messages: [{ role: 'user' }, { role: 'assistant' }],
      },
      {}
    );

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const debugUrl = getRequestUrl(0);
    expect(debugUrl.searchParams.getAll('tags')).toEqual(['bugfix', 'solution']);
    expect(debugUrl.searchParams.get('limit')).toBe('20');
    expect(result?.prependSystemContext).toContain('<relevant-memories>');
  });

  it('uses legacy autoRecallLimit as the fallback for all recall phases', async () => {
    const handler = registerBeforePromptHandler({
      pluginConfig: {
        autoRecallLimit: 8,
        defaultTags: ['mcp-automem'],
      },
    });

    mockFetch
      .mockResolvedValueOnce(jsonResponse({ results: [], count: 0 }))
      .mockResolvedValueOnce(jsonResponse({ results: [], count: 0 }));

    await handler(
      {
        prompt: 'Review the mcp-automem release process',
        messages: [{ role: 'user', content: 'Review the mcp-automem release process' }],
      },
      {}
    );

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(getRequestUrl(0).searchParams.get('limit')).toBe('8');
    expect(getRequestUrl(1).searchParams.get('limit')).toBe('8');
  });

  it('falls back to a generic greeting when startup recall has no profile cues', async () => {
    const handler = registerBeforePromptHandler({
      config: {
        agents: {
          defaults: {
            skipBootstrap: true,
          },
        },
      },
    });

    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        results: [
          {
            id: 'mem-work',
            memory: {
              content: 'Recent work on onboarding docs.',
              tags: ['openclaw'],
              type: 'Context',
            },
          },
        ],
        count: 1,
      })
    );

    const result = await handler(
      {
        prompt: 'hi',
        messages: [{ role: 'user', content: 'hi' }],
      },
      {}
    );

    expect(result?.prependSystemContext).toContain('Use a generic greeting');
    expect(result?.prependSystemContext).not.toContain('AutoJack');
  });
});
