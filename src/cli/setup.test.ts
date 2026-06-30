import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { runConfig, runSetup } from './setup.js';

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

describe('runSetup — deprecated AUTOMEM_ENDPOINT alias migration', () => {
  let tmpDir: string;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'automem-setup-test-'));
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('keeps a pre-existing AUTOMEM_ENDPOINT line in sync with the new endpoint', async () => {
    const envPath = path.join(tmpDir, '.env');
    fs.writeFileSync(envPath, 'AUTOMEM_ENDPOINT=https://old.example.test\nKEEP_ME=1\n');

    await runSetup(['--env', envPath, '--endpoint', 'https://new.example.test', '--yes']);

    const envText = fs.readFileSync(envPath, 'utf8');
    expect(envText).toContain('AUTOMEM_API_URL=https://new.example.test');
    // The stale legacy value must not survive — it would silently resurface
    // if AUTOMEM_API_URL were ever removed.
    expect(envText).not.toContain('https://old.example.test');
    expect(envText).toContain('KEEP_ME=1');
  });

  it('does not introduce the deprecated alias into a fresh .env', async () => {
    const envPath = path.join(tmpDir, '.env');

    await runSetup(['--env', envPath, '--endpoint', 'https://new.example.test', '--yes']);

    const envText = fs.readFileSync(envPath, 'utf8');
    expect(envText).toContain('AUTOMEM_API_URL=https://new.example.test');
    expect(envText).not.toContain('AUTOMEM_ENDPOINT');
  });
});
