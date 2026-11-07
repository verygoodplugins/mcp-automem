import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  chooseLocalPorts,
  discoverExistingLocalServer,
  discoverPreferredLocalServer,
  dockerRunning,
  inspectLocalVersion,
  isPortAvailable,
  launchDocker,
  portEnv,
  readLocalPorts,
  waitForDocker,
  type CapturedCommand,
  type LocalPorts,
} from './local-docker.js';
import {
  buildInstallPlan,
  detectInstallEnvironment,
  equivalentInstallCommand,
  parseInstallArgs,
  prepareLocalServer,
  verifyAutoMemEndpoint,
} from './install.js';

const ports: LocalPorts = {
  FALKORDB_HOST_PORT: 6379,
  FALKORDB_BROWSER_HOST_PORT: 3000,
  QDRANT_HOST_PORT: 6333,
  QDRANT_GRPC_HOST_PORT: 6334,
  AUTOMEM_API_HOST_PORT: 8001,
};
const temporaryDirs: string[] = [];
function tempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'automem-docker-test-'));
  temporaryDirs.push(dir);
  return dir;
}
afterEach(() =>
  temporaryDirs.splice(0).forEach((dir) => fs.rmSync(dir, { recursive: true, force: true }))
);

describe('local Docker preflight', () => {
  it('starts the installed application for each supported platform and polls the daemon', async () => {
    const run = vi.fn(() => ({ ok: true, stdout: '' }));
    expect(launchDocker('darwin', run)).toBe(true);
    expect(run).toHaveBeenCalledWith('open', ['-a', 'Docker'], 10_000);
    expect(launchDocker('win32', run)).toBe(true);
    expect(launchDocker('linux', run)).toBe(true);
    expect(dockerRunning(run)).toBe(true);
    const running = vi
      .fn()
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true);
    const delay = vi.fn(async () => {});
    expect(await waitForDocker({ running, delay, attempts: 4 })).toBe(true);
    expect(delay).toHaveBeenCalledTimes(2);
    expect(await waitForDocker({ running: () => false, delay, attempts: 2 })).toBe(false);
  });

  it('detects a port held by another process on the real host', async () => {
    const server = net.createServer();
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as net.AddressInfo).port;
    try {
      expect(await isPortAvailable(port)).toBe(false);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('prompts for each occupied port and rejects invalid, duplicate and occupied answers', async () => {
    const askPort = vi
      .fn()
      .mockResolvedValueOnce('invalid')
      .mockResolvedValueOnce('6379')
      .mockResolvedValueOnce('6334')
      .mockResolvedValueOnce('6335')
      .mockResolvedValueOnce('8002');
    const notices: string[] = [];
    const chosen = await chooseLocalPorts({
      initial: ports,
      interactive: true,
      available: async (port) => ![6333, 8001].includes(port),
      askPort,
      notice: (message) => notices.push(message),
    });
    expect(chosen).toEqual({ ...ports, QDRANT_HOST_PORT: 6335, AUTOMEM_API_HOST_PORT: 8002 });
    expect(notices.join('\n')).toMatch(/1 to 65535/);
    expect(notices.join('\n')).toMatch(/already assigned/);
    expect(askPort).toHaveBeenCalledTimes(5);
  });

  it('refuses to guess replacement ports in headless mode', async () => {
    await expect(
      chooseLocalPorts({
        initial: ports,
        interactive: false,
        available: async (port) => port !== 6333,
        askPort: vi.fn(),
        notice: vi.fn(),
      })
    ).rejects.toThrow(/QDRANT_HOST_PORT/);
  });

  it('reads persisted ports with environment taking precedence and rejects invalid values', () => {
    const dir = tempDir();
    fs.writeFileSync(path.join(dir, '.env'), 'AUTOMEM_API_HOST_PORT=8100\nQDRANT_HOST_PORT=6444\n');
    expect(readLocalPorts(dir, { AUTOMEM_API_HOST_PORT: '8200' })).toEqual({
      ...ports,
      AUTOMEM_API_HOST_PORT: 8200,
      QDRANT_HOST_PORT: 6444,
    });
    expect(() => readLocalPorts(dir, { QDRANT_HOST_PORT: '70000' })).toThrow(/QDRANT_HOST_PORT/);
  });

  it('passes every chosen port to Compose and persists the same API URL for agents', async () => {
    const dir = tempDir();
    const selected = { ...ports, QDRANT_HOST_PORT: 6444, AUTOMEM_API_HOST_PORT: 8100 };
    const commands: { command: string; args: string[]; options?: { env?: NodeJS.ProcessEnv } }[] =
      [];
    const result = await prepareLocalServer({
      localDir: path.join(dir, 'server'),
      dryRun: false,
      ports: selected,
      runCommand: (command, args, options) => commands.push({ command, args, options }),
    });
    expect(result.endpoint).toBe('http://127.0.0.1:8100');
    const envFile = fs.readFileSync(path.join(dir, 'server', '.env'), 'utf8');
    expect(envFile).toContain('QDRANT_HOST_PORT=6444');
    expect(envFile).toContain('AUTOMEM_API_HOST_PORT=8100');
    const compose = commands.find((entry) => entry.command === 'docker');
    expect(compose?.options?.env).toMatchObject(portEnv(selected));
    const options = {
      ...parseInstallArgs([], {}),
      target: 'local' as const,
      localDocker: { mode: 'new' as const, ports: selected },
    };
    const plan = buildInstallPlan({ options, environment: detectInstallEnvironment() });
    expect(plan.endpoint).toBe(result.endpoint);
    expect(equivalentInstallCommand({ ...options, apiKeyProvided: false })).toContain(
      'AUTOMEM_API_HOST_PORT=8100'
    );
  });

  it('recognizes an existing Compose API and extracts its effective credentials without printing them', async () => {
    const inspected = {
      Config: {
        Env: ['AUTOMEM_API_TOKEN=secret=value', 'ADMIN_API_TOKEN=admin'],
        Labels: {
          'com.docker.compose.service': 'flask-api',
          'com.docker.compose.project': 'automem',
          'com.docker.compose.project.working_dir': '/tmp/server',
          'com.docker.compose.project.config_files': '/tmp/server/docker-compose.yml',
        },
      },
      NetworkSettings: { Ports: { '8001/tcp': [{ HostIp: '0.0.0.0', HostPort: '8001' }] } },
      Mounts: [{ Type: 'bind', Source: '/tmp/server', Destination: '/app' }],
    };
    const run: CapturedCommand = (_cmd, args) => ({
      ok: true,
      stdout: args[0] === 'ps' ? 'abc\n' : JSON.stringify(inspected),
    });
    const fetchFn = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ status: 'healthy', falkordb: 'connected', qdrant: 'connected' }),
          { status: 200 }
        )
    ) as typeof fetch;
    expect(await discoverExistingLocalServer({ run, fetchFn })).toEqual({
      endpoint: 'http://127.0.0.1:8001',
      apiKey: 'secret=value',
      adminToken: 'admin',
      project: 'automem',
      localDir: '/tmp/server',
      configFile: '/tmp/server/docker-compose.yml',
      sourceMounted: true,
    });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const wrongBinding: CapturedCommand = (_cmd, args) => ({
      ok: true,
      stdout:
        args[0] === 'ps'
          ? 'abc\n'
          : JSON.stringify({
              ...inspected,
              NetworkSettings: {
                Ports: { '8001/tcp': [{ HostIp: '127.0.0.2', HostPort: '8001' }] },
              },
            }),
    });
    expect(await discoverExistingLocalServer({ run: wrongBinding, fetchFn })).toBeUndefined();
    // Do not probe an unrelated service when Docker's host binding does not match.
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('rediscovers a running API when its host port differs from its container port', async () => {
    const run: CapturedCommand = (_command, args) => {
      if (args[0] === 'ps') {
        // A mapped API exposes container port 8001 and publishes host port 8100.
        // Docker 29's publish filter matches the host port, not the container port.
        const found = args.includes('expose=8001') || args.includes('publish=8100');
        return { ok: true, stdout: found ? 'api-container\n' : '' };
      }
      return {
        ok: true,
        stdout: JSON.stringify({
          Config: {
            Env: ['AUTOMEM_API_TOKEN=test-key'],
            Labels: { 'com.docker.compose.service': 'flask-api' },
          },
          NetworkSettings: { Ports: { '8001/tcp': [{ HostIp: '127.0.0.1', HostPort: '8100' }] } },
        }),
      };
    };
    const fetchFn = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ status: 'healthy', falkordb: 'connected', qdrant: 'connected' })
        )
    ) as typeof fetch;
    expect(await discoverExistingLocalServer({ apiPort: 8100, run, fetchFn })).toMatchObject({
      endpoint: 'http://127.0.0.1:8100',
      apiKey: 'test-key',
    });
    expect(fetchFn).toHaveBeenCalledWith('http://127.0.0.1:8100/health', expect.anything());
  });

  it('checks the standard port first, then a previously configured custom port', async () => {
    const standard = { endpoint: 'http://127.0.0.1:8001' };
    const discover = vi.fn(async ({ apiPort }: { apiPort: number }) =>
      apiPort === 8001 ? standard : undefined
    );
    expect(await discoverPreferredLocalServer(8100, discover)).toEqual(standard);
    expect(discover).toHaveBeenCalledTimes(1);
    discover.mockClear();
    discover.mockImplementation(async ({ apiPort }) =>
      apiPort === 8100 ? { endpoint: 'http://127.0.0.1:8100' } : undefined
    );
    expect((await discoverPreferredLocalServer(8100, discover))?.endpoint).toBe(
      'http://127.0.0.1:8100'
    );
    expect(discover.mock.calls.map(([arg]) => arg.apiPort)).toEqual([8001, 8100]);
  });

  it('does not treat a healthy but authentication-protected server as connected without a key', async () => {
    const fetchFn = async (url: string) =>
      url.endsWith('/health')
        ? { ok: true, status: 200, json: async () => ({ status: 'healthy' }) }
        : { ok: false, status: 401 };
    await expect(
      verifyAutoMemEndpoint({ endpoint: 'http://localhost:8001', verifyRecall: true, fetchFn })
    ).resolves.toMatchObject({ ok: false, message: expect.stringContaining('401') });
  });

  it('does not mistake a generic health endpoint or the MCP sidecar for AutoMem', async () => {
    const run: CapturedCommand = (_command, args) => ({
      ok: true,
      stdout:
        args[0] === 'ps'
          ? 'abc'
          : JSON.stringify({
              NetworkSettings: {
                Ports: { '8001/tcp': [{ HostIp: '127.0.0.1', HostPort: '8001' }] },
              },
            }),
    });
    for (const body of [{ status: 'ok' }, { status: 'healthy', transports: [], endpoints: {} }]) {
      const fetchFn = (async () =>
        new Response(JSON.stringify(body), { status: 200 })) as typeof fetch;
      expect(await discoverExistingLocalServer({ run, fetchFn })).toBeUndefined();
    }
  });

  it('reuses a healthy matching non-Compose container without guessing its credentials', async () => {
    const run: CapturedCommand = (_command, args) => ({
      ok: true,
      stdout:
        args[0] === 'ps'
          ? 'abc'
          : JSON.stringify({
              Config: { Env: ['AUTOMEM_API_TOKEN=do-not-use'] },
              NetworkSettings: {
                Ports: { '8001/tcp': [{ HostIp: '127.0.0.1', HostPort: '8100' }] },
              },
            }),
    });
    const fetchFn = (async () =>
      new Response(
        JSON.stringify({ status: 'healthy', falkordb: 'connected', qdrant: 'connected' })
      )) as typeof fetch;
    expect(await discoverExistingLocalServer({ apiPort: 8100, run, fetchFn })).toEqual({
      endpoint: 'http://127.0.0.1:8100',
    });
  });

  it('only offers an update for a clean, official checkout with a changed tracked branch', () => {
    const dir = tempDir();
    const configFile = path.join(dir, 'docker-compose.yml');
    fs.writeFileSync(configFile, 'services: {}\n');
    const server = {
      endpoint: 'http://127.0.0.1:8001',
      localDir: dir,
      configFile,
      project: 'automem',
      sourceMounted: true,
    };
    const head = 'a'.repeat(40),
      remote = 'b'.repeat(40);
    function runner(
      dirty = false,
      remoteSha = remote,
      url = 'https://github.com/verygoodplugins/automem.git'
    ): CapturedCommand {
      return (_command, args) => {
        const tail = args.slice(2).join(' ');
        if (tail === 'remote get-url origin') return { ok: true, stdout: url };
        if (tail === 'rev-parse HEAD') return { ok: true, stdout: head };
        if (tail === 'describe --tags --always') return { ok: true, stdout: 'v0.16.2' };
        if (tail === 'symbolic-ref --quiet --short HEAD') return { ok: true, stdout: 'develop' };
        if (tail === 'rev-parse --abbrev-ref --symbolic-full-name @{upstream}')
          return { ok: true, stdout: 'origin/develop' };
        if (tail.startsWith('ls-remote'))
          return { ok: true, stdout: `${remoteSha}\trefs/heads/develop` };
        if (tail.startsWith('merge-base')) return { ok: false, stdout: '' };
        if (tail === 'status --porcelain') return { ok: true, stdout: dirty ? ' M app.py' : '' };
        return { ok: false, stdout: '' };
      };
    }
    expect(inspectLocalVersion(server, runner())).toMatchObject({
      label: 'v0.16.2',
      status: 'different',
      canUpdate: true,
    });
    expect(inspectLocalVersion({ ...server, sourceMounted: false }, runner())).toMatchObject({
      status: 'unknown',
      canUpdate: false,
    });
    expect(inspectLocalVersion(server, runner(true))).toMatchObject({
      status: 'different',
      canUpdate: false,
    });
    expect(inspectLocalVersion(server, runner(false, head))).toMatchObject({
      status: 'current',
      canUpdate: false,
    });
    expect(
      inspectLocalVersion(server, runner(false, remote, 'https://example.com/other.git'))
    ).toMatchObject({ status: 'unknown', canUpdate: false });
  });
});
