import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { once } from 'node:events';

export interface FakeAutoMemApi {
  url: string;
  requests: Array<{
    method: string;
    path: string;
    body: unknown;
    authorization?: string;
  }>;
  close: () => Promise<void>;
}

export async function startFakeAutoMemApi(): Promise<FakeAutoMemApi> {
  const requests: FakeAutoMemApi['requests'] = [];
  let memoryCounter = 0;

  const server = http.createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    const method = req.method ?? 'GET';
    if (method !== 'GET' && method !== 'HEAD') {
      req.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      await once(req, 'end');
    }

    const rawBody = Buffer.concat(chunks).toString('utf8');
    let body: unknown = undefined;
    if (rawBody.trim()) {
      body = JSON.parse(rawBody);
    }

    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    requests.push({
      method,
      path: `${url.pathname}${url.search}`,
      body,
      authorization: req.headers.authorization,
    });

    const sendJson = (status: number, payload: unknown) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(payload));
    };

    if (method === 'GET' && url.pathname === '/health') {
      sendJson(200, {
        status: 'healthy',
        falkordb: 'ok',
        qdrant: 'ok',
        graph: { nodes: memoryCounter },
        timestamp: '2026-06-06T00:00:00.000Z',
      });
      return;
    }

    if (method === 'GET' && url.pathname === '/recall') {
      const tags = url.searchParams.getAll('tags');
      const query = url.searchParams.get('query') || '';
      const kind = tags.includes('preference')
        ? 'preference'
        : tags.includes('bugfix')
          ? 'debug'
          : query
            ? 'task-context'
            : 'generic';
      sendJson(200, {
        results: [
          {
            id: `mem-recalled-${kind}-${query || tags.join('-') || 'generic'}`,
            match_type: 'keyword',
            final_score: 0.99,
            score_components: {},
            memory: {
              content: `remembered host smoke detail (${kind})`,
              summary: `host smoke summary (${kind})`,
              tags,
              importance: 0.8,
              timestamp: '2026-06-06T00:00:00.000Z',
            },
          },
        ],
        count: 1,
      });
      return;
    }

    if (method === 'POST' && url.pathname === '/memory') {
      memoryCounter += 1;
      sendJson(200, {
        memory_id: `mem-${memoryCounter}`,
        message: 'Memory stored successfully',
      });
      return;
    }

    if (method === 'POST' && url.pathname === '/associate') {
      sendJson(200, { message: 'Association created successfully' });
      return;
    }

    if (method === 'PATCH' && url.pathname.startsWith('/memory/')) {
      sendJson(200, {
        memory_id: decodeURIComponent(url.pathname.slice('/memory/'.length)),
        message: 'Memory updated successfully',
      });
      return;
    }

    sendJson(404, { detail: `Unhandled fake AutoMem route: ${method} ${url.pathname}` });
  });

  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Fake AutoMem API did not bind a TCP port');
  }

  return {
    url: `http://127.0.0.1:${address.port}`,
    requests,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
};

export interface McpInitializeResult {
  instructions?: string;
  [key: string]: unknown;
}

export class StdioMcpClient {
  private child: ChildProcessWithoutNullStreams;
  private nextId = 1;
  private pending = new Map<number, PendingRequest>();
  private stdoutBuffer = '';
  private stderrBuffer = '';
  private invalidStdout: string[] = [];

  constructor(
    command: string,
    args: string[],
    env: NodeJS.ProcessEnv,
    cwd: string,
  ) {
    this.child = spawn(command, args, {
      cwd,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    this.child.stdout.setEncoding('utf8');
    this.child.stdout.on('data', (chunk: string) => this.handleStdout(chunk));
    this.child.stderr.setEncoding('utf8');
    this.child.stderr.on('data', (chunk: string) => {
      this.stderrBuffer += chunk;
    });
    this.child.on('exit', (code, signal) => {
      const error = new Error(
        `MCP server exited before response (code=${code}, signal=${signal})\n${this.stderrBuffer}`,
      );
      for (const pending of this.pending.values()) {
        pending.reject(error);
      }
      this.pending.clear();
    });
  }

  get stderr(): string {
    return this.stderrBuffer;
  }

  get invalidStdoutLines(): string[] {
    return this.invalidStdout;
  }

  private handleStdout(chunk: string): void {
    this.stdoutBuffer += chunk;
    let newline = this.stdoutBuffer.indexOf('\n');
    while (newline !== -1) {
      const line = this.stdoutBuffer.slice(0, newline).trim();
      this.stdoutBuffer = this.stdoutBuffer.slice(newline + 1);
      if (line) {
        this.handleLine(line);
      }
      newline = this.stdoutBuffer.indexOf('\n');
    }
  }

  private handleLine(line: string): void {
    let message: unknown;
    try {
      message = JSON.parse(line);
    } catch {
      this.invalidStdout.push(line);
      return;
    }

    if (!message || typeof message !== 'object') return;
    const response = message as { id?: unknown; error?: unknown; result?: unknown };
    if (typeof response.id === 'number' && this.pending.has(response.id)) {
      const pending = this.pending.get(response.id)!;
      this.pending.delete(response.id);
      if (response.error) {
        pending.reject(new Error(JSON.stringify(response.error)));
      } else {
        pending.resolve(response.result);
      }
    }
  }

  request(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    const id = this.nextId++;
    const payload = { jsonrpc: '2.0', id, method, params };
    this.child.stdin.write(`${JSON.stringify(payload)}\n`);
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Timed out waiting for ${method}\n${this.stderrBuffer}`));
      }, 10_000);
      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timeout);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timeout);
          reject(error);
        },
      });
    });
  }

  notify(method: string, params: Record<string, unknown> = {}): void {
    const payload = { jsonrpc: '2.0', method, params };
    this.child.stdin.write(`${JSON.stringify(payload)}\n`);
  }

  async initialize(): Promise<McpInitializeResult> {
    const result = await this.request('initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'automem-host-smoke', version: '0.0.0' },
    });
    this.notify('notifications/initialized');
    return result as McpInitializeResult;
  }

  async close(): Promise<void> {
    this.child.stdin.end();
    const exit = once(this.child, 'exit');
    setTimeout(() => {
      if (!this.child.killed) {
        this.child.kill('SIGTERM');
      }
    }, 1_000).unref();
    await exit;
  }
}

export function localMcpServerCommand(repoRoot: string): { command: string; args: string[] } {
  return {
    command: process.execPath,
    args: ['--import', 'tsx', path.join(repoRoot, 'src/index.ts')],
  };
}

export function hermesPythonPath(): string | null {
  const hermes = spawnSync('which', ['hermes'], { encoding: 'utf8' });
  if (hermes.status !== 0) {
    return null;
  }
  const wrapper = hermes.stdout.trim();
  const candidates: string[] = [];
  try {
    const text = fs.readFileSync(wrapper, 'utf8');
    const match = text.match(/exec\s+"([^"]*\/venv\/bin\/hermes)"/);
    if (match) {
      candidates.push(path.join(path.dirname(match[1]), 'python'));
    }
  } catch {
    // Fall through to path-based candidates.
  }
  candidates.push(
    path.resolve(path.dirname(wrapper), '..', 'hermes-agent', 'venv', 'bin', 'python'),
    path.join(process.env.HOME ?? '', '.hermes', 'hermes-agent', 'venv', 'bin', 'python'),
  );

  for (const python of candidates) {
    const check = spawnSync(python, ['-c', 'import hermes_cli.prompt_size'], { encoding: 'utf8' });
    if (check.status === 0) return python;
  }
  return null;
}

export function duplicateCounts(names: string[]): Record<string, number> {
  const counts = new Map<string, number>();
  for (const name of names) {
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return Object.fromEntries([...counts.entries()].filter(([, count]) => count > 1));
}
