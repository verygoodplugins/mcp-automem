import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const nodeFetchMock = vi.fn();

vi.mock('node-fetch', () => ({
  default: nodeFetchMock,
}));

describe('memory queue command', () => {
  let tempRoot: string;
  let originalEnv: NodeJS.ProcessEnv;
  let globalFetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'automem-queue-'));
    originalEnv = { ...process.env };
    process.env.AUTOMEM_API_URL = 'http://memory.example';
    process.env.AUTOMEM_API_KEY = 'test-key';
    nodeFetchMock.mockReset();
    nodeFetchMock.mockResolvedValue({ ok: true, status: 200 });
    globalFetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ memory_id: 'mem-123', message: 'stored' }),
    });
    vi.stubGlobal('fetch', globalFetchMock);
  });

  afterEach(() => {
    process.env = originalEnv;
    fs.rmSync(tempRoot, { recursive: true, force: true });
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('forwards top-level storage quality fields from queue records', async () => {
    const queuePath = path.join(tempRoot, 'memory-queue.jsonl');
    fs.writeFileSync(
      queuePath,
      `${JSON.stringify({
        content: 'Deployed mcp-automem to production on railway',
        tags: ['deployment', 'mcp-automem', 'railway'],
        importance: 0.9,
        type: 'Context',
        confidence: 0.85,
        timestamp: '2026-06-04T05:00:00Z',
        t_valid: '2026-06-04T05:00:00Z',
        t_invalid: '2026-07-04T05:00:00Z',
        metadata: { platform: 'railway' },
      })}\n`,
      'utf8'
    );

    const { runQueueCommand } = await import('./queue.js');
    await runQueueCommand(['--file', queuePath]);

    const storedBody = JSON.parse(globalFetchMock.mock.calls[0][1].body);
    expect(storedBody).toMatchObject({
      content: 'Deployed mcp-automem to production on railway',
      tags: ['deployment', 'mcp-automem', 'railway'],
      importance: 0.9,
      type: 'Context',
      confidence: 0.85,
      timestamp: '2026-06-04T05:00:00Z',
      t_valid: '2026-06-04T05:00:00Z',
      t_invalid: '2026-07-04T05:00:00Z',
      metadata: { platform: 'railway' },
    });
  });

  it('resolves AutoMem endpoint from CODEX_HOME config.toml when env is absent', async () => {
    delete process.env.AUTOMEM_API_URL;
    delete process.env.AUTOMEM_ENDPOINT;
    delete process.env.AUTOMEM_API_KEY;
    delete process.env.AUTOMEM_API_TOKEN;

    const codexHome = path.join(tempRoot, '.codex');
    fs.mkdirSync(codexHome, { recursive: true });
    process.env.CODEX_HOME = codexHome;
    fs.writeFileSync(
      path.join(codexHome, 'config.toml'),
      [
        '[mcp_servers.memory]',
        'command = "npx"',
        'args = ["-y", "@verygoodplugins/mcp-automem"]',
        '',
        '[mcp_servers.memory.env]',
        'AUTOMEM_API_URL = "https://memory.example"',
        'AUTOMEM_API_KEY = "codex-key"',
        '',
      ].join('\n'),
      'utf8'
    );
    const queuePath = path.join(tempRoot, 'memory-queue.jsonl');
    fs.writeFileSync(queuePath, `${JSON.stringify({ content: 'Codex config queue item' })}\n`);

    const { runQueueCommand } = await import('./queue.js');
    await runQueueCommand(['--file', queuePath]);

    expect(nodeFetchMock.mock.calls[0][0]).toBe('https://memory.example/health');
    expect(globalFetchMock.mock.calls[0][0]).toBe('https://memory.example/memory');
    expect(globalFetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer codex-key');
  });
});
