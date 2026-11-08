import { spawnSync } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { parse as parseToml } from 'smol-toml';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyCodexSetup } from '../../src/cli/codex.js';
import { WELCOME_PROMPT, startWelcome, welcomeTargets } from '../../src/cli/welcome.js';
import { HOST_SMOKE_SPECS } from '../helpers/host-specs.js';
import { fakeMemoryId, startFakeAutoMemApi, StdioMcpClient } from '../helpers/host-smoke.js';

const REPO_ROOT = path.resolve(__dirname, '../..');
const hasCodex =
  process.platform !== 'win32' &&
  spawnSync('codex', ['--version'], { stdio: 'ignore' }).status === 0;
const expectedTools = [
  'store_memory',
  'recall_memory',
  'associate_memories',
  'update_memory',
  'delete_memory',
  'check_database_health',
];
type ProviderTool = { name?: string; tools?: Array<{ name?: string }> };

function writeNpxShim(bin: string, codexHome: string, startupDelaySeconds = 0): void {
  const quote = (value: string) => `'${value.replace(/'/g, "'\\''")}'`;
  const probe = quote(path.join(path.dirname(codexHome), 'npx-probe'));
  const lines = [
    '#!/bin/sh',
    `[ "$(pwd -P)" = ${quote(fs.realpathSync(path.join(codexHome, 'automem')))} ] || { printf cwd > ${probe}; exit 90; }`,
    `[ -z "\${AUTOMEM_API_KEY:-}" ] || { printf key > ${probe}; exit 91; }`,
    `[ -z "\${AUTOMEM_API_TOKEN:-}" ] || { printf token > ${probe}; exit 92; }`,
    `[ "$AUTOMEM_CONNECTION_FILE" = ${quote(path.join(codexHome, 'automem', 'connection.json'))} ] || { printf path > ${probe}; exit 93; }`,
    ...(startupDelaySeconds ? [`sleep ${startupDelaySeconds}`] : []),
    `exec ${quote(process.execPath)} --import ${quote(import.meta.resolve('tsx'))} ${quote(path.join(REPO_ROOT, 'src/index.ts'))}`,
  ];
  fs.writeFileSync(path.join(bin, 'npx'), `${lines.join('\n')}\n`, { mode: 0o755 });
}

describe('Codex host contract', () => {
  let root: string;
  let codexHome: string;
  let project: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'automem-codex-smoke-'));
    codexHome = path.join(root, 'codex');
    project = path.join(root, 'project');
    fs.mkdirSync(project);
    vi.stubEnv('CODEX_HOME', codexHome);
    for (const name of [
      'AUTOMEM_API_URL',
      'AUTOMEM_ENDPOINT',
      'AUTOMEM_API_KEY',
      'AUTOMEM_API_TOKEN',
    ])
      vi.stubEnv(name, '');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('runs the configured MCP server against the isolated AutoMem API', async () => {
    const api = await startFakeAutoMemApi();
    try {
      await applyCodexSetup({
        rulesPath: path.join(project, 'AGENTS.md'),
        endpoint: api.url,
        apiKey: 'codex-smoke-key',
        quiet: true,
      });
      const config = parseToml(fs.readFileSync(path.join(codexHome, 'config.toml'), 'utf8')) as {
        mcp_servers: {
          memory: { command: string; args: string[]; cwd: string; env: Record<string, string> };
        };
      };
      const entry = config.mcp_servers.memory;
      expect(entry.command).toBe('npx');
      expect(entry.args).toEqual(['-y', '@verygoodplugins/mcp-automem@latest']);
      expect(JSON.stringify(entry)).not.toContain('codex-smoke-key');
      expect(entry.cwd).toBe(path.join(codexHome, 'automem'));
      fs.writeFileSync(
        path.join(project, '.env'),
        'AUTOMEM_API_URL=https://unrelated.example\nAUTOMEM_API_KEY=project-secret\n'
      );
      const client = new StdioMcpClient(
        process.execPath,
        ['--import', import.meta.resolve('tsx'), path.join(REPO_ROOT, 'src/index.ts')],
        {
          PATH: process.env.PATH,
          HOME: root,
          DOTENV_CONFIG_QUIET: 'true',
          AUTOMEM_API_KEY: 'unrelated-shell-key',
          ...entry.env,
        },
        entry.cwd
      );
      try {
        await client.initialize();
        const listed = (await client.request('tools/list')) as { tools: Array<{ name: string }> };
        expect(listed.tools.map((tool) => tool.name)).toEqual(expectedTools);
        await client.request('tools/call', { name: 'check_database_health', arguments: {} });
        await client.request('tools/call', {
          name: 'recall_memory',
          arguments: { query: 'codex smoke', limit: 1 },
        });
        await client.request('tools/call', {
          name: 'store_memory',
          arguments: { content: 'codex smoke', tags: ['codex-smoke'] },
        });
        await client.request('tools/call', {
          name: 'update_memory',
          arguments: { memory_id: fakeMemoryId(1), importance: 0.8 },
        });
        await client.request('tools/call', {
          name: 'associate_memories',
          arguments: {
            memory1_id: fakeMemoryId(1),
            memory2_id: fakeMemoryId(2),
            type: 'RELATES_TO',
            strength: 0.7,
          },
        });
        expect(client.invalidStdoutLines).toEqual([]);
        expect(
          api.requests.map((request) => request.method + ' ' + request.path.split('?')[0])
        ).toEqual(
          expect.arrayContaining([
            'GET /health',
            'GET /recall',
            'POST /memory',
            `PATCH /memory/${fakeMemoryId(1)}`,
            'POST /associate',
          ])
        );
        expect(
          api.requests.every((request) => request.authorization === 'Bearer codex-smoke-key')
        ).toBe(true);
      } finally {
        await client.close();
      }
    } finally {
      await api.close();
    }
  }, 30_000);

  it.skipIf(!hasCodex)(
    'discovers AutoMem through the installed Codex app server before a model turn',
    async () => {
      const api = await startFakeAutoMemApi();
      try {
        await applyCodexSetup({
          rulesPath: path.join(project, 'AGENTS.md'),
          endpoint: api.url,
          apiKey: 'codex-smoke-key',
          quiet: true,
        });
        const bin = path.join(root, 'bin');
        fs.mkdirSync(bin);
        // Replace only npx in this isolated test: Codex still starts its configured
        // executable, but the shim runs this checkout without a registry request.
        writeNpxShim(bin, codexHome);
        const client = new StdioMcpClient(
          'codex',
          ['app-server'],
          {
            PATH: `${bin}${path.delimiter}${process.env.PATH}`,
            HOME: root,
            CODEX_HOME: codexHome,
            TMPDIR: os.tmpdir(),
            DOTENV_CONFIG_QUIET: 'true',
            AUTOMEM_API_KEY: 'unrelated-shell-key',
          },
          project
        );
        try {
          await client.request('initialize', {
            clientInfo: { name: 'automem-host-smoke', version: '0.0.0' },
          });
          client.notify('initialized');
          const status = (await client.request('mcpServerStatus/list', {})) as {
            data: Array<{ name: string; tools: Record<string, unknown> }>;
          };
          const memory = status.data.find((server) => server.name === 'memory');
          expect(memory).toBeDefined();
          const probe = path.join(root, 'npx-probe');
          expect(
            Object.keys(memory!.tools).sort(),
            `MCP launcher probe: ${fs.existsSync(probe) ? fs.readFileSync(probe, 'utf8') : 'no failure recorded'}`
          ).toEqual([...expectedTools].sort());
          const providerNames = status.data.flatMap((server) =>
            Object.keys(server.tools).map((tool) => `mcp__${server.name}__${tool}`)
          );
          expect(new Set(providerNames).size).toBe(providerNames.length);
          const thread = (await client.request('thread/start', {
            cwd: project,
            ephemeral: true,
          })) as { thread: { id: string } };
          await client.request('mcpServer/tool/call', {
            threadId: thread.thread.id,
            server: 'memory',
            tool: 'check_database_health',
            arguments: {},
          });
          expect(api.requests.some((request) => request.path === '/health')).toBe(true);
          expect(
            api.requests.every((request) => request.authorization === 'Bearer codex-smoke-key')
          ).toBe(true);
          expect(client.invalidStdoutLines).toEqual([]);
        } finally {
          await client.close();
        }
      } finally {
        await api.close();
      }
    },
    30_000
  );

  it.skipIf(!hasCodex)(
    'includes AutoMem tools in the first welcome turn even when the server starts slowly',
    async () => {
      const api = await startFakeAutoMemApi();
      let deliverPayload: (value: { tools: ProviderTool[]; input: unknown }) => void = () => {};
      const payload = new Promise<{ tools: ProviderTool[]; input: unknown }>((resolve) => {
        deliverPayload = resolve;
      });
      const provider = http.createServer((req, res) => {
        const chunks: Buffer[] = [];
        req.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
        req.on('end', () => {
          if (req.url?.endsWith('/responses')) {
            deliverPayload(JSON.parse(Buffer.concat(chunks).toString('utf8')));
            res.writeHead(200, { 'Content-Type': 'text/event-stream' });
            res.end(
              `event: response.completed\ndata: ${JSON.stringify({ type: 'response.completed', response: { id: 'resp_fake', object: 'response', created_at: 1, status: 'completed', model: 'gpt-5.1-codex-mini', output: [], usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 } } })}\n\n`
            );
          } else {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ object: 'list', data: [] }));
          }
        });
      });
      provider.listen(0, '127.0.0.1');
      await once(provider, 'listening');
      const address = provider.address();
      if (!address || typeof address === 'string') throw new Error('Fake provider did not bind.');
      try {
        await applyCodexSetup({
          rulesPath: path.join(project, 'AGENTS.md'),
          endpoint: api.url,
          apiKey: 'codex-smoke-key',
          quiet: true,
        });
        const configPath = path.join(codexHome, 'config.toml');
        const config = fs.readFileSync(configPath, 'utf8');
        fs.writeFileSync(
          configPath,
          `model = "gpt-5.1-codex-mini"\nmodel_provider = "fake"\n[model_providers.fake]\nname = "Fake provider"\nbase_url = "http://127.0.0.1:${address.port}/v1"\nwire_api = "responses"\nenv_key = "AUTOMEM_TEST_MODEL_KEY"\n\n${config}`
        );
        const bin = path.join(root, 'bin');
        fs.mkdirSync(bin);
        writeNpxShim(bin, codexHome, 3);
        const launch = vi.fn(() => true);
        startWelcome({
          target: welcomeTargets({
            clients: ['codex'],
            platform: 'linux',
            commandExists: () => true,
          })[0],
          cwd: project,
          configuredMemory: true,
          clearCredentials: true,
          runCommand: launch,
        });
        const launcherArgs = launch.mock.calls[0][1] as string[];
        expect(launcherArgs.at(-1)).toBe(WELCOME_PROMPT);
        const client = new StdioMcpClient(
          'codex',
          [...launcherArgs.slice(0, -1), 'app-server'],
          {
            PATH: `${bin}${path.delimiter}${process.env.PATH}`,
            HOME: root,
            CODEX_HOME: codexHome,
            TMPDIR: os.tmpdir(),
            DOTENV_CONFIG_QUIET: 'true',
            AUTOMEM_TEST_MODEL_KEY: 'test-only',
          },
          project
        );
        try {
          await client.request('initialize', {
            clientInfo: { name: 'automem-host-smoke', version: '0.0.0' },
          });
          client.notify('initialized');
          const thread = (await client.request('thread/start', {
            cwd: project,
            ephemeral: true,
          })) as { thread: { id: string } };
          await client.request('turn/start', {
            threadId: thread.thread.id,
            input: [{ type: 'text', text: WELCOME_PROMPT, text_elements: [] }],
          });
          let timer: NodeJS.Timeout | undefined;
          const sent = await Promise.race([
            payload,
            new Promise<never>((_, reject) => {
              timer = setTimeout(
                () => reject(new Error(`Timed out waiting for fake provider. ${client.stderr}`)),
                12_000
              );
            }),
          ]).finally(() => {
            if (timer) clearTimeout(timer);
          });
          // Recent Codex builds may group MCP functions into a provider-visible
          // namespace; older builds expose the same qualified names directly.
          const topLevel = sent.tools
            .map((tool) => tool.name)
            .filter((name): name is string => Boolean(name));
          expect(new Set(topLevel).size).toBe(topLevel.length);
          const names = sent.tools.flatMap((tool) =>
            tool.tools
              ? tool.tools.map((nested) => `${tool.name}__${nested.name}`)
              : tool.name
                ? [tool.name]
                : []
          );
          expect(new Set(names).size).toBe(names.length);
          const spec = HOST_SMOKE_SPECS.find((host) => host.host === 'codex')!;
          for (const name of spec.expectedToolNames) expect(names).toContain(name);
          expect(JSON.stringify(sent.input)).toContain(
            'This welcome message was prepared by the AutoMem installer'
          );
          expect(JSON.stringify(sent)).not.toContain('codex-smoke-key');
        } finally {
          await client.close();
        }
      } finally {
        provider.closeAllConnections();
        await new Promise<void>((resolve) => provider.close(() => resolve()));
        await api.close();
      }
    },
    30_000
  );
});
