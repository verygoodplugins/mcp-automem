import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { parse as parseToml } from 'smol-toml';
import { applyCodexSetup, CODEX_RULES_END, CODEX_RULES_START } from './codex.js';

describe('codex setup', () => {
  let tmpDir: string;
  let rulesPath: string;
  let codexHome: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-setup-'));
    rulesPath = path.join(tmpDir, 'AGENTS.md');
    codexHome = path.join(tmpDir, 'codex');
    vi.stubEnv('CODEX_HOME', codexHome);
    vi.stubEnv('AUTOMEM_API_URL', '');
    vi.stubEnv('AUTOMEM_ENDPOINT', '');
    vi.stubEnv('AUTOMEM_API_KEY', '');
    vi.stubEnv('AUTOMEM_API_TOKEN', '');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('registers Codex with a private connection file and preserves other config', async () => {
    fs.mkdirSync(codexHome, { recursive: true });
    const configPath = path.join(codexHome, 'config.toml');
    const original =
      '# Keep this comment\nmodel = "example"\n\n[mcp_servers.other]\ncommand = "other"\n';
    fs.writeFileSync(configPath, original);
    await applyCodexSetup({
      rulesPath,
      endpoint: 'https://memory.example',
      apiKey: 'codex-test-secret',
      quiet: true,
    });
    const content = fs.readFileSync(configPath, 'utf8');
    const config = parseToml(content) as {
      mcp_servers: { other: { command: string }; memory: unknown };
    };
    const connectionPath = path.join(codexHome, 'automem', 'connection.json');
    expect(content).toContain(original.trim());
    expect(content).not.toContain('codex-test-secret');
    expect(config.mcp_servers.other.command).toBe('other');
    expect(config.mcp_servers.memory).toMatchObject({
      command: 'npx',
      args: ['-y', '@verygoodplugins/mcp-automem@latest'],
      cwd: path.dirname(connectionPath),
      env: { AUTOMEM_CONNECTION_FILE: connectionPath, AUTOMEM_API_KEY: '', AUTOMEM_API_TOKEN: '' },
    });
    expect(JSON.parse(fs.readFileSync(connectionPath, 'utf8'))).toMatchObject({
      endpoint: 'https://memory.example',
      apiKey: 'codex-test-secret',
    });
    if (process.platform !== 'win32') expect(fs.statSync(connectionPath).mode & 0o777).toBe(0o600);
    const first = fs.readFileSync(configPath, 'utf8');
    await applyCodexSetup({ rulesPath, endpoint: 'https://memory.example', quiet: true });
    expect(fs.readFileSync(configPath, 'utf8')).toBe(first);
    expect(JSON.parse(fs.readFileSync(connectionPath, 'utf8')).apiKey).toBe('codex-test-secret');
  });

  it('does not carry a stored key to a different endpoint', async () => {
    await applyCodexSetup({
      rulesPath,
      endpoint: 'https://old.example',
      apiKey: 'old-key',
      quiet: true,
    });
    await applyCodexSetup({ rulesPath, endpoint: 'https://new.example', quiet: true });
    const connection = JSON.parse(
      fs.readFileSync(path.join(codexHome, 'automem', 'connection.json'), 'utf8')
    );
    expect(connection.endpoint).toBe('https://new.example');
    expect(connection.apiKey).toBe('');
  });

  it('keeps quoted paths and unusual API keys out of the Codex TOML', async () => {
    const customHome = path.join(tmpDir, 'Codex "quoted" home');
    vi.stubEnv('CODEX_HOME', customHome);
    const key = 'test-"quoted"-${literal}';
    await applyCodexSetup({
      rulesPath,
      endpoint: 'https://memory.example',
      apiKey: key,
      quiet: true,
    });
    const content = fs.readFileSync(path.join(customHome, 'config.toml'), 'utf8');
    const config = parseToml(content) as {
      mcp_servers: { memory: { env: { AUTOMEM_CONNECTION_FILE: string } } };
    };
    expect(config.mcp_servers.memory.env.AUTOMEM_CONNECTION_FILE).toBe(
      path.join(customHome, 'automem', 'connection.json')
    );
    expect(content).not.toContain(key);
    expect(
      JSON.parse(fs.readFileSync(config.mcp_servers.memory.env.AUTOMEM_CONNECTION_FILE, 'utf8'))
        .apiKey
    ).toBe(key);
  });

  it('does not pass a shell key bound to a different endpoint', async () => {
    vi.stubEnv('AUTOMEM_API_URL', 'https://old.example');
    vi.stubEnv('AUTOMEM_API_KEY', 'unrelated-shell-secret');
    await applyCodexSetup({ rulesPath, endpoint: 'https://new.example', quiet: true });
    const connection = JSON.parse(
      fs.readFileSync(path.join(codexHome, 'automem', 'connection.json'), 'utf8')
    );
    expect(connection).toMatchObject({ endpoint: 'https://new.example', apiKey: '' });
  });

  it('recreates a deleted connection file with newly supplied details', async () => {
    await applyCodexSetup({
      rulesPath,
      endpoint: 'https://old.example',
      apiKey: 'old-key',
      quiet: true,
    });
    const file = path.join(codexHome, 'automem', 'connection.json');
    fs.unlinkSync(file);
    await applyCodexSetup({
      rulesPath,
      endpoint: 'https://new.example',
      apiKey: 'new-key',
      quiet: true,
    });
    expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toMatchObject({
      endpoint: 'https://new.example',
      apiKey: 'new-key',
    });
  });

  it('migrates an existing AutoMem entry and protects its backup', async () => {
    fs.mkdirSync(codexHome, { recursive: true });
    const configPath = path.join(codexHome, 'config.toml');
    fs.writeFileSync(
      configPath,
      '[mcp_servers.memory]\ncommand = "npx"\nargs = ["-y", "@verygoodplugins/mcp-automem"]\n[mcp_servers.memory.env]\nAUTOMEM_API_URL = "https://memory.example"\nAUTOMEM_API_KEY = "old-secret"\n',
      { mode: 0o644 }
    );
    await applyCodexSetup({ rulesPath, endpoint: 'https://memory.example', quiet: true });
    expect(fs.readFileSync(configPath, 'utf8')).not.toContain('old-secret');
    expect(
      JSON.parse(fs.readFileSync(path.join(codexHome, 'automem', 'connection.json'), 'utf8')).apiKey
    ).toBe('old-secret');
    const backup = `${configPath}.bak`;
    expect(fs.readFileSync(backup, 'utf8')).toContain('old-secret');
    if (process.platform !== 'win32') expect(fs.statSync(backup).mode & 0o777).toBe(0o600);
  });

  it('refuses a foreign memory server without writing rules or credentials', async () => {
    fs.mkdirSync(codexHome, { recursive: true });
    const configPath = path.join(codexHome, 'config.toml');
    const original = '[mcp_servers.memory]\ncommand = "other-memory"\n';
    fs.writeFileSync(configPath, original);
    await expect(
      applyCodexSetup({
        rulesPath,
        endpoint: 'https://memory.example',
        apiKey: 'new-secret',
        quiet: true,
      })
    ).rejects.toThrow(/not AutoMem/);
    expect(fs.readFileSync(configPath, 'utf8')).toBe(original);
    expect(fs.existsSync(rulesPath)).toBe(false);
    expect(fs.existsSync(path.join(codexHome, 'automem', 'connection.json'))).toBe(false);
  });

  it('refuses to follow a connection-file symlink', async () => {
    if (process.platform === 'win32') return;
    const dir = path.join(codexHome, 'automem');
    fs.mkdirSync(dir, { recursive: true });
    const target = path.join(tmpDir, 'user-file');
    fs.writeFileSync(target, 'untouched');
    fs.symlinkSync(target, path.join(dir, 'connection.json'));
    await expect(
      applyCodexSetup({
        rulesPath,
        endpoint: 'https://memory.example',
        apiKey: 'new-secret',
        quiet: true,
      })
    ).rejects.toThrow(/symlink/i);
    expect(fs.readFileSync(target, 'utf8')).toBe('untouched');
  });

  it('refuses to overwrite an unowned connection file', async () => {
    const dir = path.join(codexHome, 'automem');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'connection.json');
    fs.writeFileSync(file, '{"owner":"someone-else"}');
    await expect(applyCodexSetup({ rulesPath, quiet: true })).rejects.toThrow(
      /not an AutoMem-managed/
    );
    expect(fs.readFileSync(file, 'utf8')).toBe('{"owner":"someone-else"}');
    expect(fs.existsSync(path.join(codexHome, 'config.toml'))).toBe(false);
  });

  it('refuses a TOML layout it cannot update without reformatting unrelated settings', async () => {
    fs.mkdirSync(codexHome, { recursive: true });
    const configPath = path.join(codexHome, 'config.toml');
    const original =
      '# preserve this\nmcp_servers = { memory = { command = "npx", args = ["@verygoodplugins/mcp-automem"] } }\n';
    fs.writeFileSync(configPath, original);
    await expect(applyCodexSetup({ rulesPath, quiet: true })).rejects.toThrow(
      /without changing unrelated formatting/
    );
    expect(fs.readFileSync(configPath, 'utf8')).toBe(original);
    expect(fs.existsSync(rulesPath)).toBe(false);
    expect(fs.existsSync(path.join(codexHome, 'automem', 'connection.json'))).toBe(false);
  });

  it('writes a marked rules block into a new AGENTS.md', async () => {
    await applyCodexSetup({ rulesPath, projectName: 'demo', quiet: true });

    const content = fs.readFileSync(rulesPath, 'utf8');
    expect(content).toContain(CODEX_RULES_START);
    expect(content).toContain(CODEX_RULES_END);
    expect(content).toContain('demo');
  });

  it('appends below existing content instead of replacing the file', async () => {
    fs.writeFileSync(rulesPath, '# My project notes\n\nKeep this.\n');

    await applyCodexSetup({ rulesPath, projectName: 'demo', quiet: true });

    const content = fs.readFileSync(rulesPath, 'utf8');
    expect(content).toContain('# My project notes');
    expect(content).toContain('Keep this.');
    expect(content.indexOf(CODEX_RULES_START)).toBeGreaterThan(content.indexOf('Keep this.'));
  });

  // The pre-extraction shape appended a bare `\n` on every merge, so each re-run grew
  // the file by one newline and no two installs produced the same bytes.
  it('re-running is byte-stable', async () => {
    await applyCodexSetup({ rulesPath, projectName: 'demo', quiet: true });
    const first = fs.readFileSync(rulesPath, 'utf8');

    await applyCodexSetup({ rulesPath, projectName: 'demo', quiet: true });
    const second = fs.readFileSync(rulesPath, 'utf8');

    expect(second).toBe(first);
    expect(second.endsWith(`${CODEX_RULES_END}\n`)).toBe(true);
  });

  it('re-running keeps content below the block in place, byte for byte', async () => {
    await applyCodexSetup({ rulesPath, projectName: 'demo', quiet: true });
    fs.writeFileSync(rulesPath, `${fs.readFileSync(rulesPath, 'utf8')}\n# Trailing notes\n`);
    const before = fs.readFileSync(rulesPath, 'utf8');

    await applyCodexSetup({ rulesPath, projectName: 'demo', quiet: true });

    expect(fs.readFileSync(rulesPath, 'utf8')).toBe(before);
  });

  // Both markers are present, so an indexOf check treats this as well-formed and
  // replaces from the first start through the end — deleting the second marker and the
  // user's notes between them.
  it('refuses when the rules file has two start markers and one end', async () => {
    const handWritten = [
      '# My notes',
      CODEX_RULES_START,
      'stale half-block',
      CODEX_RULES_START,
      'notes the user wrote between the markers',
      CODEX_RULES_END,
      '',
    ].join('\n');
    fs.writeFileSync(rulesPath, handWritten);

    await expect(applyCodexSetup({ rulesPath, projectName: 'demo', quiet: true })).rejects.toThrow(
      /found 2 start markers and 1 end marker/
    );

    expect(fs.readFileSync(rulesPath, 'utf8')).toBe(handWritten);
  });

  // Appending past a half-written block leaves one start and two ends, so the *next*
  // run replaces everything between the original start and the appended end.
  it('refuses a one-sided start marker instead of appending', async () => {
    const handWritten = ['# My notes', CODEX_RULES_START, 'half a block, no end', ''].join('\n');
    fs.writeFileSync(rulesPath, handWritten);

    await expect(applyCodexSetup({ rulesPath, projectName: 'demo', quiet: true })).rejects.toThrow(
      /without a matching/
    );

    expect(fs.readFileSync(rulesPath, 'utf8')).toBe(handWritten);
  });

  it('refuses a stray end marker too', async () => {
    const handWritten = ['# My notes', CODEX_RULES_END, ''].join('\n');
    fs.writeFileSync(rulesPath, handWritten);

    await expect(applyCodexSetup({ rulesPath, projectName: 'demo', quiet: true })).rejects.toThrow(
      /without a matching/
    );

    expect(fs.readFileSync(rulesPath, 'utf8')).toBe(handWritten);
  });

  it('refuses when the end marker precedes the start marker', async () => {
    const handWritten = ['# My notes', CODEX_RULES_END, 'user content', CODEX_RULES_START, ''].join(
      '\n'
    );
    fs.writeFileSync(rulesPath, handWritten);

    await expect(applyCodexSetup({ rulesPath, projectName: 'demo', quiet: true })).rejects.toThrow(
      /precedes/
    );

    expect(fs.readFileSync(rulesPath, 'utf8')).toBe(handWritten);
  });

  it('dry-run writes nothing', async () => {
    await applyCodexSetup({ rulesPath, projectName: 'demo', dryRun: true, quiet: true });
    expect(fs.existsSync(rulesPath)).toBe(false);
    expect(fs.existsSync(codexHome)).toBe(false);
  });

  it('dry-run still refuses a malformed rules file', async () => {
    const handWritten = [CODEX_RULES_START, 'a', CODEX_RULES_START, 'b', CODEX_RULES_END, ''].join(
      '\n'
    );
    fs.writeFileSync(rulesPath, handWritten);

    await expect(
      applyCodexSetup({ rulesPath, projectName: 'demo', dryRun: true, quiet: true })
    ).rejects.toThrow(/found 2 start markers and 1 end marker/);
  });
});
