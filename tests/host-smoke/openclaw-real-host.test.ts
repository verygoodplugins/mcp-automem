/**
 * OpenClaw plugin boundary: make the host spec executable rather than declarative.
 *
 * OpenClaw is the one supported host that does not speak stdio MCP — it loads
 * src/openclaw-plugin.ts in-process and receives tools through `api.registerTool`.
 * A spec entry in tests/helpers/host-specs.ts therefore proves nothing on its own:
 * stale or invented names there would still satisfy the parity suite. This registers
 * the real plugin and checks the names it actually hands OpenClaw against that spec,
 * then drives one tool through the shared fake AutoMem API.
 */

import { describe, expect, it } from 'vitest';
import openClawPlugin from '../../src/openclaw-plugin.js';
import { HOST_SMOKE_SPECS } from '../helpers/host-specs.js';
import { startFakeAutoMemApi } from '../helpers/host-smoke.js';

interface RegisteredTool {
  name: string;
  execute: (toolCallId: string, params: unknown) => Promise<unknown>;
}

function registerPlugin(endpoint: string, apiKey?: string): RegisteredTool[] {
  const tools: RegisteredTool[] = [];
  openClawPlugin.register({
    pluginConfig: {
      endpoint,
      ...(apiKey ? { apiKey } : {}),
      autoRecall: false,
    },
    logger: { warn: () => {} },
    registerTool: (tool) => {
      tools.push({ name: tool.name, execute: tool.execute });
    },
    on: () => {},
  });
  return tools;
}

const openClawSpec = HOST_SMOKE_SPECS.find((spec) => spec.host === 'openclaw');

describe('OpenClaw plugin boundary', () => {
  it('has a host spec to validate against', () => {
    expect(openClawSpec, 'HOST_SMOKE_SPECS is missing the openclaw entry').toBeDefined();
  });

  it('registers exactly the tool names the host spec declares', () => {
    const registered = registerPlugin('http://127.0.0.1:8001')
      .map((tool) => tool.name)
      .sort();
    // Ties the declaration to reality: renaming a tool in the plugin, or drifting the
    // spec, now fails here instead of passing as "smoke-covered".
    expect(registered).toEqual(openClawSpec!.expectedToolNames);
  });

  it('drives every AutoMem operation through the registered tools', async () => {
    const fakeApi = await startFakeAutoMemApi();
    try {
      const tools = registerPlugin(fakeApi.url, 'openclaw-smoke-key');
      const call = async (name: string, params: unknown) => {
        const tool = tools.find((candidate) => candidate.name === name);
        expect(tool, `plugin did not register ${name}`).toBeDefined();
        return tool!.execute(`call-${name}`, params);
      };

      // Exercising only recall would leave wrong methods, payloads or auth on the other
      // tools invisible — the host-integration contract names all five operations.
      await call('automem_check_health', {});
      await call('automem_recall_memory', { query: 'openclaw smoke', limit: 1 });
      await call('automem_store_memory', {
        content: 'openclaw host smoke memory',
        tags: ['openclaw-smoke'],
        importance: 0.6,
      });
      await call('automem_update_memory', { memory_id: 'mem-1', importance: 0.8 });
      await call('automem_associate_memories', {
        memory1_id: 'mem-1',
        memory2_id: 'mem-2',
        type: 'RELATES_TO',
        strength: 0.7,
      });

      const paths = fakeApi.requests.map((request) => request.path);
      expect(paths).toContain('/health');
      expect(paths.some((p) => p.startsWith('/recall'))).toBe(true);
      expect(paths).toContain('/memory');
      expect(paths).toContain('/memory/mem-1');
      expect(paths).toContain('/associate');

      const methods = fakeApi.requests.map((request) => `${request.method} ${request.path}`);
      expect(methods).toContain('POST /memory');
      expect(methods).toContain('PATCH /memory/mem-1');
      expect(methods).toContain('POST /associate');

      expect(
        fakeApi.requests.every((request) => request.authorization === 'Bearer openclaw-smoke-key')
      ).toBe(true);
    } finally {
      await fakeApi.close();
    }
  }, 20_000);
});
