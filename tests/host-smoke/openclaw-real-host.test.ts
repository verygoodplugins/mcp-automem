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

  it('reaches AutoMem through a registered tool', async () => {
    const fakeApi = await startFakeAutoMemApi();
    try {
      const tools = registerPlugin(fakeApi.url, 'openclaw-smoke-key');
      const recall = tools.find((tool) => tool.name === 'automem_recall_memory');
      expect(recall).toBeDefined();

      await recall!.execute('call-1', { query: 'openclaw smoke', limit: 1 });

      expect(fakeApi.requests.length).toBeGreaterThan(0);
      expect(fakeApi.requests.some((request) => request.path.startsWith('/recall'))).toBe(true);
      expect(
        fakeApi.requests.every((request) => request.authorization === 'Bearer openclaw-smoke-key')
      ).toBe(true);
    } finally {
      await fakeApi.close();
    }
  }, 20_000);
});
