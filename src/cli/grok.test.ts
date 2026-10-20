import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { parse as parseToml } from 'smol-toml';
import { applyGrokSetup, GROK_RULES_END, GROK_RULES_START } from './grok.js';
import { readAutoMemApiKeyFromEnv } from '../env.js';

describe('grok setup', () => {
  let tmpDir: string;
  let originalGrokHome: string | undefined;
  let originalApiUrl: string | undefined;
  let originalApiKey: string | undefined;
  let originalEndpoint: string | undefined;
  let originalApiToken: string | undefined;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'grok-setup-'));
    originalGrokHome = process.env.GROK_HOME;
    originalApiUrl = process.env.AUTOMEM_API_URL;
    originalApiKey = process.env.AUTOMEM_API_KEY;
    originalEndpoint = process.env.AUTOMEM_ENDPOINT;
    originalApiToken = process.env.AUTOMEM_API_TOKEN;
    process.env.GROK_HOME = tmpDir;
    delete process.env.AUTOMEM_API_URL;
    delete process.env.AUTOMEM_API_KEY;
    delete process.env.AUTOMEM_ENDPOINT;
    delete process.env.AUTOMEM_API_TOKEN;
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    if (originalGrokHome === undefined) delete process.env.GROK_HOME;
    else process.env.GROK_HOME = originalGrokHome;
    if (originalApiUrl === undefined) delete process.env.AUTOMEM_API_URL;
    else process.env.AUTOMEM_API_URL = originalApiUrl;
    if (originalApiKey === undefined) delete process.env.AUTOMEM_API_KEY;
    else process.env.AUTOMEM_API_KEY = originalApiKey;
    if (originalEndpoint === undefined) delete process.env.AUTOMEM_ENDPOINT;
    else process.env.AUTOMEM_ENDPOINT = originalEndpoint;
    if (originalApiToken === undefined) delete process.env.AUTOMEM_API_TOKEN;
    else process.env.AUTOMEM_API_TOKEN = originalApiToken;
  });

  it('writes mcp_servers.memory and AGENTS.md rules', async () => {
    await applyGrokSetup({
      endpoint: 'https://automem.example.test',
      apiKey: 'sk-test',
      quiet: true,
      projectName: 'demo-project',
    });

    const configPath = path.join(tmpDir, 'config.toml');
    const agentsPath = path.join(tmpDir, 'AGENTS.md');
    expect(fs.existsSync(configPath)).toBe(true);
    expect(fs.existsSync(agentsPath)).toBe(true);

    const parsed = parseToml(fs.readFileSync(configPath, 'utf8')) as {
      mcp_servers: {
        memory: { command: string; env: Record<string, string> };
      };
    };
    expect(parsed.mcp_servers.memory.command).toBe('npx');
    expect(parsed.mcp_servers.memory.env.AUTOMEM_API_URL).toBe('https://automem.example.test');
    expect(parsed.mcp_servers.memory.env.AUTOMEM_API_KEY).toBe('sk-test');
    expect(parsed.mcp_servers.memory.env.AUTOMEM_PROCESS_TAG).toBe('grok:memory');

    const agents = fs.readFileSync(agentsPath, 'utf8');
    expect(agents).toContain(GROK_RULES_START);
    expect(agents).toContain(GROK_RULES_END);
    expect(agents).toContain('memory__recall_memory');
    // This is the global rules file, so the project tag stays a placeholder even
    // though --name was given; see the dedicated cases below.
    expect(agents).toContain('tags: ["<project-slug>"]');
  });

  // ~/.grok/AGENTS.md loads in every Grok session, whatever repo it runs in. Baking
  // the install-time project into it would hard-gate every later recall to that slug
  // and tag every store with it.
  it('keeps the global rules project-agnostic', async () => {
    await applyGrokSetup({ endpoint: 'https://automem.example.test', quiet: true });

    const agents = fs.readFileSync(path.join(tmpDir, 'AGENTS.md'), 'utf8');
    // The tag gate itself must stay a placeholder, not the installer's cwd.
    expect(agents).toContain('tags: ["<project-slug>"]');
    expect(agents).toContain('use the slug of the repository you are working in');
    expect(agents).not.toContain('tags: ["mcp-automem"]');
  });

  // The target file decides, not the flags: --name and --rules can both still be
  // pointing at the global file, where a real project tag is always wrong.
  it('keeps the global rules project-agnostic even when flags name a project', async () => {
    await applyGrokSetup({
      endpoint: 'https://automem.example.test',
      quiet: true,
      projectName: 'demo-project',
    });
    const viaName = fs.readFileSync(path.join(tmpDir, 'AGENTS.md'), 'utf8');
    expect(viaName).toContain('tags: ["<project-slug>"]');
    expect(viaName).not.toContain('tags: ["demo-project"]');

    // --rules aimed explicitly at the global path is still the global path.
    await applyGrokSetup({
      endpoint: 'https://automem.example.test',
      quiet: true,
      projectName: 'demo-project',
      rulesPath: path.join(tmpDir, 'AGENTS.md'),
    });
    expect(fs.readFileSync(path.join(tmpDir, 'AGENTS.md'), 'utf8')).toContain(
      'tags: ["<project-slug>"]'
    );
  });

  it('bakes in a real project for a project-local rules file', async () => {
    const projectRules = path.join(tmpDir, 'project', 'AGENTS.md');
    fs.mkdirSync(path.dirname(projectRules), { recursive: true });
    await applyGrokSetup({
      endpoint: 'https://automem.example.test',
      quiet: true,
      rulesPath: projectRules,
      projectName: 'scoped-project',
    });
    expect(fs.readFileSync(projectRules, 'utf8')).toContain('tags: ["scoped-project"]');
  });

  it('does not carry a stored API key over to a different endpoint', async () => {
    await applyGrokSetup({
      endpoint: 'https://first.example.test',
      apiKey: 'sk-first-host',
      quiet: true,
    });

    // Re-point at another host with no --api-key: the old host's key must not follow.
    await applyGrokSetup({ endpoint: 'https://second.example.test', quiet: true });

    const parsed = parseToml(fs.readFileSync(path.join(tmpDir, 'config.toml'), 'utf8')) as {
      mcp_servers: { memory: { env: Record<string, string> } };
    };
    expect(parsed.mcp_servers.memory.env.AUTOMEM_API_URL).toBe('https://second.example.test');
    expect(parsed.mcp_servers.memory.env.AUTOMEM_API_KEY).toBe('');
  });

  it('treats a trailing slash as the same endpoint and keeps the key', async () => {
    // AutoMemClient strips the trailing slash, so these address the same server;
    // dropping the key here would leave every request unauthenticated.
    await applyGrokSetup({
      endpoint: 'https://same.example.test',
      apiKey: 'sk-keep-me',
      quiet: true,
    });
    await applyGrokSetup({ endpoint: 'https://same.example.test/', quiet: true });

    const parsed = parseToml(fs.readFileSync(path.join(tmpDir, 'config.toml'), 'utf8')) as {
      mcp_servers: { memory: { env: Record<string, string> } };
    };
    expect(parsed.mcp_servers.memory.env.AUTOMEM_API_KEY).toBe('sk-keep-me');
  });

  it('keeps the global rules project-agnostic through a symlinked path', async () => {
    // A dotfiles setup: ~/.grok/AGENTS.md is a symlink, and --rules names the real file.
    const realRules = path.join(tmpDir, 'dotfiles', 'grok-AGENTS.md');
    fs.mkdirSync(path.dirname(realRules), { recursive: true });
    fs.writeFileSync(realRules, '# dotfiles-managed\n');
    fs.symlinkSync(realRules, path.join(tmpDir, 'AGENTS.md'));

    await applyGrokSetup({
      endpoint: 'https://automem.example.test',
      quiet: true,
      rulesPath: realRules,
      projectName: 'some-project',
    });

    // Same file as the global rules, so the project tag must stay a placeholder.
    expect(fs.readFileSync(realRules, 'utf8')).toContain('tags: ["<project-slug>"]');
    expect(fs.readFileSync(realRules, 'utf8')).not.toContain('tags: ["some-project"]');
  });

  it('does not hand a shell-exported key to a different endpoint', async () => {
    // The shell's key belongs to the shell's endpoint; --endpoint elsewhere must not
    // disclose it to that host.
    process.env.AUTOMEM_API_URL = 'https://shell.example.test';
    process.env.AUTOMEM_API_KEY = 'sk-shell-host';

    await applyGrokSetup({ endpoint: 'https://elsewhere.example.test', quiet: true });

    const parsed = parseToml(fs.readFileSync(path.join(tmpDir, 'config.toml'), 'utf8')) as {
      mcp_servers: { memory: { env: Record<string, string> } };
    };
    expect(parsed.mcp_servers.memory.env.AUTOMEM_API_URL).toBe('https://elsewhere.example.test');
    expect(parsed.mcp_servers.memory.env.AUTOMEM_API_KEY).toBe('');
  });

  it('uses a shell-exported key when it belongs to the chosen endpoint', async () => {
    process.env.AUTOMEM_API_URL = 'https://shell.example.test';
    process.env.AUTOMEM_API_KEY = 'sk-shell-host';

    await applyGrokSetup({ endpoint: 'https://shell.example.test', quiet: true });

    const parsed = parseToml(fs.readFileSync(path.join(tmpDir, 'config.toml'), 'utf8')) as {
      mcp_servers: { memory: { env: Record<string, string> } };
    };
    expect(parsed.mcp_servers.memory.env.AUTOMEM_API_KEY).toBe('sk-shell-host');
  });

  it('uses an unbound shell key when no endpoint is exported', async () => {
    delete process.env.AUTOMEM_API_URL;
    process.env.AUTOMEM_API_KEY = 'sk-unbound';

    await applyGrokSetup({ endpoint: 'https://anywhere.example.test', quiet: true });

    const parsed = parseToml(fs.readFileSync(path.join(tmpDir, 'config.toml'), 'utf8')) as {
      mcp_servers: { memory: { env: Record<string, string> } };
    };
    expect(parsed.mcp_servers.memory.env.AUTOMEM_API_KEY).toBe('sk-unbound');
  });

  it('refuses to write rules over the Grok config file', async () => {
    const configPath = path.join(tmpDir, 'config.toml');
    await applyGrokSetup({ endpoint: 'https://automem.example.test', quiet: true });
    const before = fs.readFileSync(configPath, 'utf8');

    await expect(
      applyGrokSetup({
        endpoint: 'https://automem.example.test',
        quiet: true,
        rulesPath: configPath,
      })
    ).rejects.toThrow(/that is the Grok config file/);

    // The registration survives rather than being overwritten with Markdown.
    expect(fs.readFileSync(configPath, 'utf8')).toBe(before);
  });

  it('keeps the stored API key when the endpoint is unchanged', async () => {
    await applyGrokSetup({
      endpoint: 'https://same.example.test',
      apiKey: 'sk-keep-me',
      quiet: true,
    });
    await applyGrokSetup({ endpoint: 'https://same.example.test', quiet: true });

    const parsed = parseToml(fs.readFileSync(path.join(tmpDir, 'config.toml'), 'utf8')) as {
      mcp_servers: { memory: { env: Record<string, string> } };
    };
    expect(parsed.mcp_servers.memory.env.AUTOMEM_API_KEY).toBe('sk-keep-me');
  });

  it('preserves existing credentials on re-run without flags', async () => {
    await applyGrokSetup({
      endpoint: 'https://automem.example.test',
      apiKey: 'sk-persist',
      quiet: true,
      projectName: 'demo',
    });

    await applyGrokSetup({ quiet: true, projectName: 'demo' });

    const parsed = parseToml(fs.readFileSync(path.join(tmpDir, 'config.toml'), 'utf8')) as {
      mcp_servers: { memory: { env: Record<string, string> } };
    };
    expect(parsed.mcp_servers.memory.env.AUTOMEM_API_URL).toBe('https://automem.example.test');
    expect(parsed.mcp_servers.memory.env.AUTOMEM_API_KEY).toBe('sk-persist');
  });

  // Appending past a half-written block leaves one start and two ends, so the *next*
  // run replaces everything between the original start and the appended end — silently
  // eating whatever the user wrote in between.
  it('refuses to append when the rules file has a one-sided marker', async () => {
    const rulesPath = path.join(tmpDir, 'AGENTS.md');
    const handWritten = ['# My notes', GROK_RULES_START, 'half a block, no end marker', ''].join(
      '\n'
    );
    fs.writeFileSync(rulesPath, handWritten);

    await expect(
      applyGrokSetup({ endpoint: 'https://automem.example.test', quiet: true })
    ).rejects.toThrow(/does not contain exactly one/);

    // The user's file is left exactly as it was.
    expect(fs.readFileSync(rulesPath, 'utf8')).toBe(handWritten);
  });

  it('writes nothing at all when the rules file is rejected', async () => {
    // Validation used to run after the config write, so a rejected run still replaced
    // the live endpoint and credentials while telling the user to fix their rules file.
    const configPath = path.join(tmpDir, 'config.toml');
    await applyGrokSetup({
      endpoint: 'https://live.example.test',
      apiKey: 'sk-live',
      quiet: true,
    });
    const configBefore = fs.readFileSync(configPath, 'utf8');

    const rulesPath = path.join(tmpDir, 'AGENTS.md');
    fs.writeFileSync(rulesPath, ['# notes', GROK_RULES_START, 'no end marker', ''].join('\n'));
    const rulesBefore = fs.readFileSync(rulesPath, 'utf8');

    await expect(
      applyGrokSetup({ endpoint: 'https://other.example.test', apiKey: 'sk-other', quiet: true })
    ).rejects.toThrow(/does not contain exactly one/);

    // Neither file moved: no partial install.
    expect(fs.readFileSync(configPath, 'utf8')).toBe(configBefore);
    expect(fs.readFileSync(rulesPath, 'utf8')).toBe(rulesBefore);
    expect(configBefore).toContain('https://live.example.test');
    expect(configBefore).not.toContain('https://other.example.test');
  });

  // Two starts and one end: both markers are present and correctly ordered, so an
  // indexOf-based check calls the file well-formed and replaces from the first start
  // through the end — silently deleting the second marker and the user's notes.
  it('refuses when the rules file has two start markers and one end', async () => {
    const rulesPath = path.join(tmpDir, 'AGENTS.md');
    const handWritten = [
      '# My notes',
      GROK_RULES_START,
      'stale half-block',
      GROK_RULES_START,
      'notes the user wrote between the markers',
      GROK_RULES_END,
      '',
    ].join('\n');
    fs.writeFileSync(rulesPath, handWritten);

    await expect(
      applyGrokSetup({ endpoint: 'https://automem.example.test', quiet: true })
    ).rejects.toThrow(/found 2 start markers and 1 end marker/);

    expect(fs.readFileSync(rulesPath, 'utf8')).toBe(handWritten);
  });

  it('refuses when the end marker precedes the start marker', async () => {
    const rulesPath = path.join(tmpDir, 'AGENTS.md');
    const handWritten = ['# My notes', GROK_RULES_END, 'user content', GROK_RULES_START, ''].join(
      '\n'
    );
    fs.writeFileSync(rulesPath, handWritten);

    await expect(
      applyGrokSetup({ endpoint: 'https://automem.example.test', quiet: true })
    ).rejects.toThrow(/precedes/);

    expect(fs.readFileSync(rulesPath, 'utf8')).toBe(handWritten);
  });

  it('refuses on a stray end marker too', async () => {
    const rulesPath = path.join(tmpDir, 'AGENTS.md');
    fs.writeFileSync(rulesPath, ['# My notes', GROK_RULES_END, ''].join('\n'));

    await expect(
      applyGrokSetup({ endpoint: 'https://automem.example.test', quiet: true })
    ).rejects.toThrow(/does not contain exactly one/);
  });

  it('dry-run does not write files', async () => {
    await applyGrokSetup({
      endpoint: 'https://automem.example.test',
      dryRun: true,
      quiet: true,
      projectName: 'demo',
    });
    expect(fs.existsSync(path.join(tmpDir, 'config.toml'))).toBe(false);
    expect(fs.existsSync(path.join(tmpDir, 'AGENTS.md'))).toBe(false);
  });

  it('dry-run does not claim files were written', async () => {
    const lines: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => void lines.push(args.join(' '));
    try {
      await applyGrokSetup({
        endpoint: 'https://automem.example.test',
        dryRun: true,
        projectName: 'demo',
      });
    } finally {
      console.log = originalLog;
    }

    const output = lines.join('\n');
    expect(output).toContain('[DRY RUN]');
    expect(output).toContain('Dry run — no files were changed.');
    // The success report belongs to real runs only.
    expect(output).not.toContain('written to');
    expect(output).not.toContain('rules installed in');
    expect(output).not.toContain('setup complete');
  });

  it('warns when disabled_mcp_servers would keep Grok from loading AutoMem', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'config.toml'),
      ['disabled_mcp_servers = ["memory", "wordpress"]', ''].join('\n')
    );

    const lines: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => void lines.push(args.join(' '));
    try {
      await applyGrokSetup({ endpoint: 'https://automem.example.test', projectName: 'demo' });
    } finally {
      console.log = originalLog;
    }

    const output = lines.join('\n');
    expect(output).toContain('listed in disabled_mcp_servers');
    expect(output).toContain('Grok may ignore the server entry');
  });

  it('surfaces the disabled_mcp_servers warning during a dry run too', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'config.toml'),
      ['disabled_mcp_servers = ["memory"]', ''].join('\n')
    );

    const lines: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => void lines.push(args.join(' '));
    try {
      await applyGrokSetup({
        endpoint: 'https://automem.example.test',
        dryRun: true,
        projectName: 'demo',
      });
    } finally {
      console.log = originalLog;
    }

    const output = lines.join('\n');
    // The diagnostic is about existing state, so a preview must still report it...
    expect(output).toContain('listed in disabled_mcp_servers');
    // ...without claiming any work happened.
    expect(output).toContain('Dry run — no files were changed.');
    expect(output).not.toContain('setup complete');
  });

  it('stays quiet about disabled_mcp_servers when memory is not in the list', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'config.toml'),
      ['disabled_mcp_servers = ["wordpress"]', ''].join('\n')
    );

    const lines: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => void lines.push(args.join(' '));
    try {
      await applyGrokSetup({ endpoint: 'https://automem.example.test', projectName: 'demo' });
    } finally {
      console.log = originalLog;
    }

    expect(lines.join('\n')).not.toContain('disabled_mcp_servers');
  });

  // Both markers are present, so a one-sided check sees a well-formed file and
  // replaces from the first start through the end — deleting the second marker and
  // everything the user wrote between them. Counting is what catches it.
  it('refuses when the rules file has two start markers and one end', async () => {
    const rulesPath = path.join(tmpDir, 'AGENTS.md');
    const handWritten = [
      '# My notes',
      GROK_RULES_START,
      'first block',
      GROK_RULES_START,
      'content the user wrote and must not lose',
      GROK_RULES_END,
      '',
    ].join('\n');
    fs.writeFileSync(rulesPath, handWritten);

    await expect(
      applyGrokSetup({ endpoint: 'https://automem.example.test', quiet: true })
    ).rejects.toThrow(/does not contain exactly one/);

    expect(fs.readFileSync(rulesPath, 'utf8')).toBe(handWritten);
  });

  it('refuses when the end marker precedes the start marker', async () => {
    const rulesPath = path.join(tmpDir, 'AGENTS.md');
    const handWritten = ['# notes', GROK_RULES_END, 'inverted', GROK_RULES_START, ''].join('\n');
    fs.writeFileSync(rulesPath, handWritten);

    await expect(
      applyGrokSetup({ endpoint: 'https://automem.example.test', quiet: true })
    ).rejects.toThrow(/precedes/);

    expect(fs.readFileSync(rulesPath, 'utf8')).toBe(handWritten);
  });

  // A flagless re-run over an install authenticated with the deprecated alias used to
  // find no key and rewrite the entry without one, silently unauthenticating it.
  it('preserves a legacy AUTOMEM_API_TOKEN credential across a flagless re-run', async () => {
    const configPath = path.join(tmpDir, 'config.toml');
    fs.writeFileSync(
      configPath,
      [
        '[mcp_servers.memory]',
        'command = "npx"',
        'args = ["-y", "@verygoodplugins/mcp-automem"]',
        'enabled = true',
        '',
        '[mcp_servers.memory.env]',
        'AUTOMEM_API_URL = "https://legacy.example.test"',
        'AUTOMEM_API_TOKEN = "sk-legacy"',
        '',
      ].join('\n')
    );

    await applyGrokSetup({ quiet: true, projectName: 'demo' });

    const parsed = parseToml(fs.readFileSync(configPath, 'utf8')) as {
      mcp_servers: { memory: { env: Record<string, string> } };
    };
    expect(parsed.mcp_servers.memory.env.AUTOMEM_API_URL).toBe('https://legacy.example.test');
    // Carried forward, and canonicalized to the name the installer writes.
    expect(parsed.mcp_servers.memory.env.AUTOMEM_API_KEY).toBe('sk-legacy');
  });

  it('does not carry a stored key to a different endpoint', async () => {
    const configPath = path.join(tmpDir, 'config.toml');
    await applyGrokSetup({
      endpoint: 'https://first.example.test',
      apiKey: 'sk-first',
      quiet: true,
    });

    await applyGrokSetup({ endpoint: 'https://second.example.test', quiet: true });

    const parsed = parseToml(fs.readFileSync(configPath, 'utf8')) as {
      mcp_servers: { memory: { env: Record<string, string> } };
    };
    expect(parsed.mcp_servers.memory.env.AUTOMEM_API_URL).toBe('https://second.example.test');
    // Blank rather than absent, so a shell-exported key cannot be inherited by the
    // child process the host launches with this env layered over its own.
    expect(parsed.mcp_servers.memory.env.AUTOMEM_API_KEY).toBe('');
    expect(parsed.mcp_servers.memory.env.AUTOMEM_API_TOKEN).toBe('');
  });

  it('does not carry a shell key exported for another endpoint', async () => {
    process.env.AUTOMEM_API_URL = 'https://shell.example.test';
    process.env.AUTOMEM_API_KEY = 'sk-shell';

    await applyGrokSetup({ endpoint: 'https://chosen.example.test', quiet: true });

    const parsed = parseToml(fs.readFileSync(path.join(tmpDir, 'config.toml'), 'utf8')) as {
      mcp_servers: { memory: { env: Record<string, string> } };
    };
    // Blank rather than absent, so a shell-exported key cannot be inherited by the
    // child process the host launches with this env layered over its own.
    expect(parsed.mcp_servers.memory.env.AUTOMEM_API_KEY).toBe('');
    expect(parsed.mcp_servers.memory.env.AUTOMEM_API_TOKEN).toBe('');
  });

  // The boundary that matters: the host launches the server with the entry's env
  // layered over its own. Omitting the key from the entry does not stop a
  // shell-exported one — issued for a different endpoint — from reaching the child.
  it('shadows a shell key so the launched server cannot inherit it', async () => {
    process.env.AUTOMEM_API_URL = 'https://shell.example.test';
    process.env.AUTOMEM_API_KEY = 'sk-shell';

    await applyGrokSetup({ endpoint: 'https://chosen.example.test', quiet: true });

    const parsed = parseToml(fs.readFileSync(path.join(tmpDir, 'config.toml'), 'utf8')) as {
      mcp_servers: { memory: { env: Record<string, string> } };
    };
    // Exactly how the host spawns it.
    const childEnv = { ...process.env, ...parsed.mcp_servers.memory.env };
    expect(childEnv.AUTOMEM_API_URL).toBe('https://chosen.example.test');
    expect(readAutoMemApiKeyFromEnv(childEnv)).toBeUndefined();
  });

  it('shadows a shell key exported under the deprecated alias too', async () => {
    process.env.AUTOMEM_ENDPOINT = 'https://shell.example.test';
    process.env.AUTOMEM_API_TOKEN = 'sk-shell-legacy';

    await applyGrokSetup({ endpoint: 'https://chosen.example.test', quiet: true });

    const parsed = parseToml(fs.readFileSync(path.join(tmpDir, 'config.toml'), 'utf8')) as {
      mcp_servers: { memory: { env: Record<string, string> } };
    };
    const childEnv = { ...process.env, ...parsed.mcp_servers.memory.env };
    expect(readAutoMemApiKeyFromEnv(childEnv)).toBeUndefined();
  });

  it('still hands a resolved key to the launched server', async () => {
    await applyGrokSetup({
      endpoint: 'https://chosen.example.test',
      apiKey: 'sk-real',
      quiet: true,
    });

    const parsed = parseToml(fs.readFileSync(path.join(tmpDir, 'config.toml'), 'utf8')) as {
      mcp_servers: { memory: { env: Record<string, string> } };
    };
    const childEnv = { ...process.env, ...parsed.mcp_servers.memory.env };
    expect(readAutoMemApiKeyFromEnv(childEnv)).toBe('sk-real');
  });
});
