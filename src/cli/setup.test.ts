import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runConfig } from './setup.js';

describe('runConfig — API key handling in printed snippets', () => {
  const REAL_KEY = 'sk-super-secret-runconfig';
  let logs: string[];
  let logSpy: ReturnType<typeof vi.spyOn>;
  let originalApiUrl: string | undefined;
  let originalApiKey: string | undefined;

  beforeEach(() => {
    logs = [];
    logSpy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      logs.push(args.map(String).join(' '));
    });
    originalApiUrl = process.env.AUTOMEM_API_URL;
    originalApiKey = process.env.AUTOMEM_API_KEY;
    process.env.AUTOMEM_API_URL = 'https://memory.example.com';
    process.env.AUTOMEM_API_KEY = REAL_KEY;
  });

  afterEach(() => {
    logSpy.mockRestore();
    const restore = (key: string, value: string | undefined) => {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    };
    restore('AUTOMEM_API_URL', originalApiUrl);
    restore('AUTOMEM_API_KEY', originalApiKey);
  });

  it('text output masks the key in the Hermes snippet but keeps the real endpoint', async () => {
    await runConfig([]);
    const out = logs.join('\n');

    expect(out).not.toContain(REAL_KEY);
    expect(out).toContain('${AUTOMEM_API_KEY}');
    expect(out).toContain('https://memory.example.com');
  });

  it('--format=json intentionally echoes the resolved key (config-generation surface)', async () => {
    await runConfig(['--format=json']);
    const out = logs.join('\n');

    // The JSON dump is the single surface that deliberately includes the key,
    // so a developer can paste a working config. The Hermes/Claude snippets do not.
    expect(out).toContain(REAL_KEY);
  });
});
