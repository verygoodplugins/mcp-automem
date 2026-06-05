import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applyCodexSetup } from './codex.js';
import type { CodexSetupOptions } from './codex.js';

type HookCommand = {
  command: string;
};

type HookMatcher = {
  matcher?: string;
  hooks?: HookCommand[];
};

type CodexHooksJson = {
  hooks?: Record<string, HookMatcher[]>;
};

type QueueRecord = {
  content: string;
  type?: string;
  confidence?: number;
  tags?: string[];
  t_valid?: string;
  metadata: Record<string, string | number | null | undefined>;
};

function makeTempRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'automem-codex-'));
}

function readJson(filePath: string): CodexHooksJson {
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as CodexHooksJson;
}

function hookCommands(hooksJson: CodexHooksJson, eventName: string): string[] {
  return (hooksJson.hooks?.[eventName] ?? []).flatMap((entry) =>
    (entry.hooks ?? []).map((hook) => hook.command)
  );
}

function runHookScript(params: {
  codexHome: string;
  scriptName: string;
  payload: unknown;
  cwd: string;
}): void {
  const scriptPath = path.join(params.codexHome, 'hooks', params.scriptName);
  const result = spawnSync('bash', [scriptPath], {
    input: JSON.stringify(params.payload),
    encoding: 'utf8',
    cwd: params.cwd,
    env: {
      ...process.env,
      HOME: path.dirname(params.codexHome),
      CODEX_HOME: params.codexHome,
      PATH: process.env.PATH ?? '',
    },
  });

  expect(result.status, result.stderr || result.stdout).toBe(0);
}

function readQueue(codexHome: string): QueueRecord[] {
  const queuePath = path.join(codexHome, 'scripts', 'memory-queue.jsonl');
  if (!fs.existsSync(queuePath)) return [];
  return fs
    .readFileSync(queuePath, 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as QueueRecord);
}

describe('codex CLI setup', () => {
  let tempRoot: string;

  beforeEach(() => {
    tempRoot = makeTempRoot();
  });

  afterEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  it('installs Codex rules, hooks, and support scripts into user-level Codex home', async () => {
    const codexHome = path.join(tempRoot, '.codex');
    const rulesPath = path.join(tempRoot, 'AGENTS.md');

    await applyCodexSetup({
      targetDir: codexHome,
      rulesPath,
      projectName: 'mcp-automem',
      quiet: true,
    });

    expect(fs.readFileSync(rulesPath, 'utf8')).toContain('persistent context for mcp-automem');

    const hooksJson = readJson(path.join(codexHome, 'hooks.json'));
    expect(hooksJson.hooks?.SessionStart?.[0].matcher).toBe('startup|resume');
    expect(hooksJson.hooks?.PostToolUse?.[0].matcher).toBe('Bash');
    expect(hooksJson.hooks?.Stop).toHaveLength(1);
    expect(hooksJson.hooks?.Stop?.[0].hooks).toHaveLength(1);
    expect(hookCommands(hooksJson, 'Stop')[0]).toContain(
      path.join(codexHome, 'scripts', 'drain-queue.sh')
    );

    expect(fs.existsSync(path.join(codexHome, 'hooks', 'automem-session-start.sh'))).toBe(true);
    expect(fs.existsSync(path.join(codexHome, 'hooks', 'capture-build-result.sh'))).toBe(true);
    expect(fs.existsSync(path.join(codexHome, 'hooks', 'capture-test-pattern.sh'))).toBe(true);
    expect(fs.existsSync(path.join(codexHome, 'hooks', 'capture-deployment.sh'))).toBe(true);
    expect(fs.existsSync(path.join(codexHome, 'hooks', 'session-memory.sh'))).toBe(false);
    expect(fs.existsSync(path.join(codexHome, 'scripts', 'drain-queue.sh'))).toBe(true);
    expect(fs.existsSync(path.join(codexHome, 'scripts', 'queue-cleanup.sh'))).toBe(true);
    expect(fs.statSync(path.join(codexHome, 'scripts', 'drain-queue.sh')).mode & 0o111).toBeTruthy();
  });

  it('merges hooks.json idempotently without duplicating existing commands', async () => {
    const codexHome = path.join(tempRoot, '.codex');
    const rulesPath = path.join(tempRoot, 'AGENTS.md');
    fs.mkdirSync(codexHome, { recursive: true });
    fs.writeFileSync(
      path.join(codexHome, 'hooks.json'),
      JSON.stringify(
        {
          hooks: {
            PostToolUse: [
              {
                matcher: 'Bash',
                hooks: [{ type: 'command', command: 'echo custom' }],
              },
            ],
          },
        },
        null,
        2
      )
    );

    const options: CodexSetupOptions = {
      targetDir: codexHome,
      rulesPath,
      projectName: 'mcp-automem',
      quiet: true,
    };
    await applyCodexSetup(options);
    await applyCodexSetup(options);

    const hooksJson = readJson(path.join(codexHome, 'hooks.json'));
    const postCommands = hookCommands(hooksJson, 'PostToolUse');
    const drainCommands = hookCommands(hooksJson, 'Stop');

    expect(postCommands.filter((command) => command === 'echo custom')).toHaveLength(1);
    expect(
      postCommands.filter((command) => command.includes('capture-build-result.sh'))
    ).toHaveLength(1);
    expect(drainCommands.filter((command) => command.includes('drain-queue.sh'))).toHaveLength(1);
  });

  it('supports rules-only installation with --no-hooks behavior', async () => {
    const codexHome = path.join(tempRoot, '.codex');
    const rulesPath = path.join(tempRoot, 'AGENTS.md');

    await applyCodexSetup({
      targetDir: codexHome,
      rulesPath,
      projectName: 'mcp-automem',
      noHooks: true,
      quiet: true,
    });

    expect(fs.existsSync(rulesPath)).toBe(true);
    expect(fs.existsSync(path.join(codexHome, 'hooks.json'))).toBe(false);
    expect(fs.existsSync(path.join(codexHome, 'hooks'))).toBe(false);
    expect(fs.existsSync(path.join(codexHome, 'scripts'))).toBe(false);
  });

  it('does not write rules or hooks in dry-run mode', async () => {
    const codexHome = path.join(tempRoot, '.codex');
    const rulesPath = path.join(tempRoot, 'AGENTS.md');

    await applyCodexSetup({
      targetDir: codexHome,
      rulesPath,
      projectName: 'mcp-automem',
      dryRun: true,
      quiet: true,
    });

    expect(fs.existsSync(rulesPath)).toBe(false);
    expect(fs.existsSync(path.join(codexHome, 'hooks.json'))).toBe(false);
  });

  it('captures a sanitized build success record from Codex JSON stdin', async () => {
    const codexHome = path.join(tempRoot, '.codex');
    await applyCodexSetup({
      targetDir: codexHome,
      rulesPath: path.join(tempRoot, 'AGENTS.md'),
      projectName: 'mcp-automem',
      quiet: true,
    });

    runHookScript({
      codexHome,
      scriptName: 'capture-build-result.sh',
      cwd: tempRoot,
      payload: {
        session_id: 'fixture-build-success',
        cwd: tempRoot,
        tool_input: { command: 'npm run build' },
        tool_response: {
          exit_code: 0,
          stdout: 'built in 1.2s\n2 warnings\ndist/main.js 45 KB',
        },
      },
    });

    const [record] = readQueue(codexHome);
    expect(record).toMatchObject({
      type: 'Context',
      confidence: 0.85,
      tags: ['build', 'npm', 'typescript', path.basename(tempRoot)],
      metadata: { originSessionId: 'fixture-build-success' },
    });
    expect(record.content).toContain('Build succeeded');
    expect(record.t_valid).toBeTruthy();
  });

  it('captures test failures without serialized tool responses or heredoc paste noise', async () => {
    const codexHome = path.join(tempRoot, '.codex');
    await applyCodexSetup({
      targetDir: codexHome,
      rulesPath: path.join(tempRoot, 'AGENTS.md'),
      projectName: 'mcp-automem',
      quiet: true,
    });

    runHookScript({
      codexHome,
      scriptName: 'capture-test-pattern.sh',
      cwd: tempRoot,
      payload: {
        session_id: 'fixture-test-fail',
        cwd: tempRoot,
        tool_input: { command: 'vitest run' },
        tool_response: {
          exit_code: 1,
          stdout:
            'FAIL src/server.test.ts\nAssertionError: expected 200 to be 401\nTests: 1 failed | 11 passed\n' +
            'git commit -m "$(cat <<EOF\nfix(server): tighten auth\nEOF\n)"',
        },
      },
    });

    const [record] = readQueue(codexHome);
    const serialized = `${record.content}\n${record.metadata.error_details}`;
    expect(record.type).toBe('Insight');
    expect(record.tags).toContain('failure');
    expect(record.t_valid).toBeTruthy();
    expect(serialized).toContain('AssertionError');
    expect(serialized).not.toContain('"stdout"');
    expect(serialized).not.toContain('cat <<');
    expect(serialized).not.toContain('EOF');
  });

  it('captures production deployments with temporal validity', async () => {
    const codexHome = path.join(tempRoot, '.codex');
    await applyCodexSetup({
      targetDir: codexHome,
      rulesPath: path.join(tempRoot, 'AGENTS.md'),
      projectName: 'mcp-automem',
      quiet: true,
    });

    runHookScript({
      codexHome,
      scriptName: 'capture-deployment.sh',
      cwd: tempRoot,
      payload: {
        session_id: 'fixture-deploy',
        cwd: tempRoot,
        tool_input: { command: 'railway up' },
        tool_response: {
          exit_code: 0,
          stdout: 'Deployment URL: https://my-app.up.railway.app\n',
        },
      },
    });

    const [record] = readQueue(codexHome);
    expect(record).toMatchObject({
      type: 'Context',
      confidence: 0.9,
      tags: ['deployment', 'railway', 'production', path.basename(tempRoot)],
      metadata: { originSessionId: 'fixture-deploy' },
    });
    expect(record.content).toContain('https://my-app.up.railway.app');
    expect(record.t_valid).toBeTruthy();
  });

  it('does not queue a memory for unrelated Bash output', async () => {
    const codexHome = path.join(tempRoot, '.codex');
    await applyCodexSetup({
      targetDir: codexHome,
      rulesPath: path.join(tempRoot, 'AGENTS.md'),
      projectName: 'mcp-automem',
      quiet: true,
    });

    runHookScript({
      codexHome,
      scriptName: 'capture-build-result.sh',
      cwd: tempRoot,
      payload: {
        session_id: 'fixture-read',
        cwd: tempRoot,
        tool_input: { command: 'cat README.md' },
        tool_response: { exit_code: 0, stdout: 'hello' },
      },
    });

    expect(readQueue(codexHome)).toEqual([]);
  });
});
