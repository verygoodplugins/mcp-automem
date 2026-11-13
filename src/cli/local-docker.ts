import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { parse as parseDotenv } from 'dotenv';

/** Host-side Compose ports, including both database protocols and the browser. */
export const LOCAL_PORTS = {
  FALKORDB_HOST_PORT: { label: 'FalkorDB', defaultPort: 6379 },
  FALKORDB_BROWSER_HOST_PORT: { label: 'FalkorDB browser', defaultPort: 3000 },
  QDRANT_HOST_PORT: { label: 'Qdrant HTTP', defaultPort: 6333 },
  QDRANT_GRPC_HOST_PORT: { label: 'Qdrant gRPC', defaultPort: 6334 },
  AUTOMEM_API_HOST_PORT: { label: 'AutoMem API', defaultPort: 8001 },
} as const;

export type LocalPortKey = keyof typeof LOCAL_PORTS;
export type LocalPorts = Record<LocalPortKey, number>;
export type LocalDockerPlan =
  | { mode: 'new'; ports: LocalPorts }
  | {
      mode: 'reuse';
      endpoint: string;
      update: boolean;
      project?: string;
      configFile?: string;
      localDir?: string;
      sourceMounted?: boolean;
      apiToken?: string;
      adminToken?: string;
      version: string;
    };

export type CapturedCommand = (
  command: string,
  args: string[],
  timeoutMs?: number
) => {
  ok: boolean;
  stdout: string;
  stderr?: string;
};

export const captureCommand: CapturedCommand = (command, args, timeoutMs = 8_000) => {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    timeout: timeoutMs,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return { ok: result.status === 0, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
};

export function dockerRunning(run: CapturedCommand = captureCommand): boolean {
  return run('docker', ['info'], 3_000).ok;
}

export type DockerStatus = 'running' | 'permission-denied' | 'unavailable';

/**
 * One `docker info` probe that tells a stopped daemon from one this user may not
 * use. Starting Docker cannot fix the second, so callers must not keep waiting.
 */
export function dockerStatus(run: CapturedCommand = captureCommand): DockerStatus {
  const result = run('docker', ['info'], 3_000);
  if (result.ok) return 'running';
  return /permission denied/i.test(`${result.stderr ?? ''}\n${result.stdout}`)
    ? 'permission-denied'
    : 'unavailable';
}

/** Start the installed desktop app/service; never install Docker or request sudo. */
export function launchDocker(
  platform: NodeJS.Platform,
  run: CapturedCommand = captureCommand
): boolean {
  if (platform === 'darwin') return run('open', ['-a', 'Docker'], 10_000).ok;
  if (platform === 'win32') {
    return run(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        'Start-Process "$env:ProgramFiles\\Docker\\Docker\\Docker Desktop.exe"',
      ],
      10_000
    ).ok;
  }
  if (platform === 'linux') {
    return (
      run('systemctl', ['--user', 'start', 'docker-desktop'], 10_000).ok ||
      run('systemctl', ['start', 'docker'], 10_000).ok
    );
  }
  return false;
}

export async function waitForDocker(
  params: {
    running?: () => boolean;
    delay?: (ms: number) => Promise<void>;
    attempts?: number;
    deadlineMs?: number;
  } = {}
): Promise<boolean> {
  const running = params.running ?? dockerRunning;
  const delay =
    params.delay ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const attempts = params.attempts ?? 45;
  const deadline = Date.now() + (params.deadlineMs ?? 90_000);
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (running()) return true;
    const remaining = deadline - Date.now();
    if (remaining <= 0) return false;
    if (attempt + 1 < attempts) await delay(Math.min(2_000, remaining));
  }
  return false;
}

function portNumber(value: string | undefined): number | undefined {
  if (!value || !/^\d+$/.test(value)) return undefined;
  const number = Number(value);
  return number >= 1 && number <= 65535 ? number : undefined;
}

export function readLocalPorts(localDir: string, env: NodeJS.ProcessEnv = process.env): LocalPorts {
  const envFile = path.join(localDir, '.env');
  const file = fs.existsSync(envFile) ? parseDotenv(fs.readFileSync(envFile, 'utf8')) : {};
  return Object.fromEntries(
    Object.entries(LOCAL_PORTS).map(([key, spec]) => {
      const value = env[key] || file[key];
      const parsed = value ? portNumber(value) : spec.defaultPort;
      if (!parsed) throw new Error(`${key} must be a TCP port from 1 to 65535.`);
      return [key, parsed];
    })
  ) as LocalPorts;
}

function canListen(port: number, host: string, ipv6Only = false): Promise<boolean | 'unsupported'> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', (err: NodeJS.ErrnoException) =>
      resolve(err.code === 'EAFNOSUPPORT' || err.code === 'EADDRNOTAVAIL' ? 'unsupported' : false)
    );
    server.listen({ port, host, ipv6Only, exclusive: true }, () =>
      server.close(() => resolve(true))
    );
  });
}

export async function isPortAvailable(port: number): Promise<boolean> {
  const ipv4 = await canListen(port, '0.0.0.0');
  if (ipv4 !== true) return false;
  const ipv6 = await canListen(port, '::', true);
  if (ipv6 !== true && ipv6 !== 'unsupported') return false;

  // macOS can permit a wildcard bind alongside a service bound to a specific
  // address. Check each interface as well, particularly loopback and LAN hosts.
  const addresses = new Set(['127.0.0.1', '::1']);
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries ?? []) {
      // Link-local IPv6 needs a scope id; Docker's default published ports do
      // not use those addresses. The wildcard and loopback probes cover IPv6.
      if (!entry.address.startsWith('fe80:')) addresses.add(entry.address);
    }
  }
  for (const address of addresses) {
    const result = await canListen(port, address, net.isIPv6(address));
    if (result === false) return false;
  }
  return true;
}

export async function chooseLocalPorts(params: {
  initial: LocalPorts;
  interactive: boolean;
  available?: (port: number) => Promise<boolean>;
  askPort: (key: LocalPortKey, suggested: number) => Promise<string>;
  notice: (message: string) => void;
}): Promise<LocalPorts> {
  const available = params.available ?? isPortAvailable;
  const result = { ...params.initial };
  const selected = new Set<number>();
  const reserved = new Set(Object.values(params.initial));
  for (const [key, spec] of Object.entries(LOCAL_PORTS) as [
    LocalPortKey,
    (typeof LOCAL_PORTS)[LocalPortKey],
  ][]) {
    let port = result[key];
    if (selected.has(port) || !(await available(port))) {
      if (!params.interactive) {
        throw new Error(
          `${spec.label} port ${port} is unavailable. Set ${key} to a free port and re-run; --yes cannot choose one for you.`
        );
      }
      params.notice(`${spec.label} port ${port} is already in use.`);
      let suggested = port;
      for (let i = 0; i < 65535; i += 1) {
        suggested = suggested === 65535 ? 1024 : suggested + 1;
        if (!selected.has(suggested) && !reserved.has(suggested) && (await available(suggested)))
          break;
        if (i === 65534) throw new Error('No free TCP port found.');
      }
      for (;;) {
        const entered = await params.askPort(key, suggested);
        const parsed = portNumber(entered.trim());
        if (!parsed) {
          params.notice('Enter a port from 1 to 65535.');
        } else if (selected.has(parsed) || (reserved.has(parsed) && parsed !== port)) {
          params.notice(`Port ${parsed} is already assigned to another AutoMem service.`);
        } else if (!(await available(parsed))) {
          params.notice(`Port ${parsed} is already in use.`);
        } else {
          port = parsed;
          break;
        }
      }
    }
    result[key] = port;
    selected.add(port);
  }
  return result;
}

type Container = {
  Config?: { Env?: string[]; Labels?: Record<string, string> };
  NetworkSettings?: { Ports?: Record<string, { HostIp?: string; HostPort?: string }[] | null> };
  Mounts?: { Type?: string; Source?: string; Destination?: string }[];
};
export type ExistingLocalServer = {
  endpoint: string;
  apiKey?: string;
  adminToken?: string;
  project?: string;
  localDir?: string;
  configFile?: string;
  sourceMounted?: boolean;
};

/** A Docker-published API plus AutoMem's distinctive health payload identifies the service. */
export async function discoverExistingLocalServer(
  params: {
    run?: CapturedCommand;
    fetchFn?: typeof fetch;
    apiPort?: number;
  } = {}
): Promise<ExistingLocalServer | undefined> {
  const run = params.run ?? captureCommand;
  const apiPort = params.apiPort ?? 8001;
  // Match the API's container-side port; Docker's publish filter can match the
  // host-side port instead. Inspect below verifies the host binding before we
  // probe the endpoint or trust credentials from a matching container.
  const ids = run('docker', ['ps', '--filter', 'expose=8001', '--format', '{{.ID}}']);
  if (!ids.ok || !ids.stdout.trim()) return undefined;
  const endpoint = `http://127.0.0.1:${apiPort}`;
  let matchingBinding = false;
  let composeApi: Container | undefined;
  for (const id of ids.stdout.trim().split(/\s+/)) {
    // Capture in memory only: inspect's environment contains credentials.
    const inspected = run('docker', ['inspect', '--format', '{{json .}}', id]);
    if (!inspected.ok) continue;
    try {
      const container = JSON.parse(inspected.stdout) as Container;
      const bindings = container.NetworkSettings?.Ports?.['8001/tcp'] ?? [];
      if (
        !bindings.some(
          (binding) =>
            binding.HostPort === String(apiPort) &&
            ['0.0.0.0', '127.0.0.1', '::', '::1', ''].includes(binding.HostIp ?? '')
        )
      )
        continue;
      matchingBinding = true;
      if (container.Config?.Labels?.['com.docker.compose.service'] === 'flask-api') {
        composeApi = container;
        break;
      }
    } catch {
      /* another container may have the binding */
    }
  }
  // A container exposing 8001 internally may publish a different host port.
  // Never probe an unrelated service listening on the requested host port.
  if (!matchingBinding) return undefined;
  try {
    const response = await (params.fetchFn ?? fetch)(`${endpoint}/health`, {
      signal: AbortSignal.timeout(2_000),
    });
    if (!response.ok) return undefined;
    const health = (await response.json()) as Record<string, unknown>;
    if (
      typeof health.status !== 'string' ||
      typeof health.falkordb !== 'string' ||
      typeof health.qdrant !== 'string'
    )
      return undefined;
  } catch {
    return undefined;
  }
  // The health endpoint is AutoMem but its container is not a recognizable Compose
  // API service. Reuse it; never guess how to update it or where its secrets live.
  if (!composeApi) return { endpoint };
  const labels = composeApi.Config?.Labels ?? {};
  const values = Object.fromEntries(
    (composeApi.Config?.Env ?? []).map((entry) => {
      const split = entry.indexOf('=');
      return split < 0 ? [entry, ''] : [entry.slice(0, split), entry.slice(split + 1)];
    })
  );
  const localDir = labels['com.docker.compose.project.working_dir'];
  const files = labels['com.docker.compose.project.config_files'];
  const configFile =
    files && !files.includes(',') && localDir ? path.resolve(localDir, files) : undefined;
  const sourceMounted = Boolean(
    localDir &&
    composeApi.Mounts?.some(
      (mount) =>
        mount.Type === 'bind' &&
        mount.Source &&
        path.resolve(mount.Source) === path.resolve(localDir) &&
        mount.Destination === '/app'
    )
  );
  return {
    endpoint,
    apiKey: values.AUTOMEM_API_TOKEN || values.AUTOMEM_API_KEY || undefined,
    adminToken: values.ADMIN_API_TOKEN || undefined,
    project: labels['com.docker.compose.project'],
    localDir,
    configFile,
    sourceMounted,
  };
}

/** Prefer the standard running server, even if a previous install saved another port. */
export async function discoverPreferredLocalServer(
  configuredPort: number,
  discover: (params: {
    apiPort: number;
  }) => Promise<ExistingLocalServer | undefined> = discoverExistingLocalServer
): Promise<ExistingLocalServer | undefined> {
  return (
    (await discover({ apiPort: 8001 })) ??
    (configuredPort === 8001 ? undefined : discover({ apiPort: configuredPort }))
  );
}

export type LocalVersion = {
  label: string;
  status: 'current' | 'different' | 'unknown';
  canUpdate: boolean;
  reason?: string;
};

export function inspectLocalVersion(
  server: ExistingLocalServer,
  run: CapturedCommand = captureCommand
): LocalVersion {
  const dir = server.localDir;
  const unknown = (reason: string): LocalVersion => ({
    label: 'unknown',
    status: 'unknown',
    canUpdate: false,
    reason,
  });
  if (!dir || !server.project || !server.configFile || !fs.existsSync(server.configFile))
    return unknown('The running Compose checkout could not be identified.');
  if (!server.sourceMounted)
    return unknown(
      'The running API image cannot be tied to the checkout version; update it manually if needed.'
    );
  const git = (...args: string[]) => run('git', ['-C', dir, ...args]);
  const remote = git('remote', 'get-url', 'origin');
  if (
    !remote.ok ||
    !/^(https:\/\/github\.com\/verygoodplugins\/automem(?:\.git)?|git@github\.com:verygoodplugins\/automem(?:\.git)?)\/?$/i.test(
      remote.stdout.trim()
    )
  )
    return unknown('The checkout is not the official AutoMem repository.');
  const head = git('rev-parse', 'HEAD');
  const description = git('describe', '--tags', '--always');
  const branch = git('symbolic-ref', '--quiet', '--short', 'HEAD');
  const upstream = git('rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}');
  const label = description.ok
    ? description.stdout.trim()
    : head.stdout.trim().slice(0, 12) || 'unknown';
  if (
    !head.ok ||
    !branch.ok ||
    !upstream.ok ||
    upstream.stdout.trim() !== `origin/${branch.stdout.trim()}`
  )
    return {
      label,
      status: 'unknown',
      canUpdate: false,
      reason: 'The checkout has no matching origin tracking branch.',
    };
  const remoteHead = run(
    'git',
    ['-C', dir, 'ls-remote', '--heads', 'origin', `refs/heads/${branch.stdout.trim()}`],
    15_000
  );
  const sha = remoteHead.stdout.trim().split(/\s+/)[0];
  if (!remoteHead.ok || !/^[a-f0-9]{40}$/i.test(sha))
    return {
      label,
      status: 'unknown',
      canUpdate: false,
      reason: 'Could not check the tracked branch on GitHub.',
    };
  if (head.stdout.trim() === sha) return { label, status: 'current', canUpdate: false };
  // If the remote commit is already an ancestor of this checkout, it is ahead;
  // rebuilding it is not an update. Unknown commits simply make this test fail.
  if (git('merge-base', '--is-ancestor', sha, head.stdout.trim()).ok) {
    return { label, status: 'current', canUpdate: false };
  }
  const dirty = git('status', '--porcelain');
  if (!dirty.ok || dirty.stdout.trim())
    return {
      label,
      status: 'different',
      canUpdate: false,
      reason: 'The checkout has uncommitted changes; update it manually.',
    };
  return { label, status: 'different', canUpdate: true };
}

export function portEnv(ports: LocalPorts): Record<LocalPortKey, string> {
  return Object.fromEntries(
    Object.entries(ports).map(([key, value]) => [key, String(value)])
  ) as Record<LocalPortKey, string>;
}
