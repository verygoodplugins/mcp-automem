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

  // setup had no credential/endpoint pairing at all and read only the canonical key
  // name, so a legacy token was invisible to the code that should have removed it.
  it('keeps the key when the stored endpoint is quoted or commented', async () => {
    const envPath = path.join(tmpDir, '.env');
    fs.writeFileSync(
      envPath,
      "AUTOMEM_API_URL='https://same.example.test' # production\nAUTOMEM_API_KEY=sk-keep\n"
    );

    await runSetup(['--env', envPath, '--endpoint', 'https://same.example.test', '--yes']);

    expect(fs.readFileSync(envPath, 'utf8')).toContain('sk-keep');
  });

  it('removes a legacy AUTOMEM_API_TOKEN when the endpoint changes', async () => {
    const envPath = path.join(tmpDir, '.env');
    fs.writeFileSync(
      envPath,
      'AUTOMEM_ENDPOINT=https://old.example.test\nAUTOMEM_API_TOKEN=sk-old\nKEEP_ME=1\n'
    );

    await runSetup(['--env', envPath, '--endpoint', 'https://new.example.test', '--yes']);

    const envText = fs.readFileSync(envPath, 'utf8');
    expect(envText).not.toContain('sk-old');
    expect(envText).not.toMatch(/^AUTOMEM_API_TOKEN=/m);
    expect(envText).toContain('KEEP_ME=1');
  });

  it('removes a canonical key written for a different endpoint', async () => {
    const envPath = path.join(tmpDir, '.env');
    fs.writeFileSync(envPath, 'AUTOMEM_API_URL=https://old.example.test\nAUTOMEM_API_KEY=sk-old\n');

    await runSetup(['--env', envPath, '--endpoint', 'https://new.example.test', '--yes']);

    const envText = fs.readFileSync(envPath, 'utf8');
    expect(envText).not.toContain('sk-old');
    expect(envText).toContain('AUTOMEM_API_URL=https://new.example.test');
  });

  it('keeps the key on a re-run at the same endpoint', async () => {
    const envPath = path.join(tmpDir, '.env');
    fs.writeFileSync(
      envPath,
      'AUTOMEM_API_URL=https://same.example.test\nAUTOMEM_API_KEY=sk-keep\n'
    );

    await runSetup(['--env', envPath, '--endpoint', 'https://same.example.test', '--yes']);

    expect(fs.readFileSync(envPath, 'utf8')).toContain('AUTOMEM_API_KEY=sk-keep');
  });

  it('does not write a shell key exported for a different endpoint', async () => {
    const envPath = path.join(tmpDir, '.env');
    const prevUrl = process.env.AUTOMEM_API_URL;
    const prevKey = process.env.AUTOMEM_API_KEY;
    process.env.AUTOMEM_API_URL = 'https://shell.example.test';
    process.env.AUTOMEM_API_KEY = 'sk-shell';
    try {
      await runSetup(['--env', envPath, '--endpoint', 'https://chosen.example.test', '--yes']);
      expect(fs.readFileSync(envPath, 'utf8')).not.toContain('sk-shell');
    } finally {
      if (prevUrl === undefined) delete process.env.AUTOMEM_API_URL;
      else process.env.AUTOMEM_API_URL = prevUrl;
      if (prevKey === undefined) delete process.env.AUTOMEM_API_KEY;
      else process.env.AUTOMEM_API_KEY = prevKey;
    }
  });

  it('does not introduce the deprecated alias into a fresh .env', async () => {
    const envPath = path.join(tmpDir, '.env');

    await runSetup(['--env', envPath, '--endpoint', 'https://new.example.test', '--yes']);

    const envText = fs.readFileSync(envPath, 'utf8');
    expect(envText).toContain('AUTOMEM_API_URL=https://new.example.test');
    expect(envText).not.toContain('AUTOMEM_ENDPOINT');
  });
});
