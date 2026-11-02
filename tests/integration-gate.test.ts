import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

let endpoint: string;
let healthStatus = 'healthy';
const server = createServer((_request, response) => {
  response.setHeader('Content-Type', 'application/json');
  response.end(
    JSON.stringify({
      status: healthStatus,
      falkordb: 'connected',
      qdrant: 'connected',
      vector_dimensions: { collection: 1024 },
    })
  );
});

beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing test server port');
  endpoint = `http://127.0.0.1:${address.port}`;
});
afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve()))
  );
});

async function runHealthChecks(required: boolean) {
  const child = spawn(
    process.execPath,
    [
      'node_modules/vitest/vitest.mjs',
      'run',
      '--config',
      'vitest.integration.config.ts',
      '--testNamePattern',
      'Health Check',
    ],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        CI: '',
        NO_COLOR: '1',
        AUTOMEM_TEST_API_URL: endpoint,
        AUTOMEM_TEST_API_KEY: 'gate-test-token',
        AUTOMEM_REQUIRE_SERVICE: required ? '1' : '0',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  );
  let output = '';
  child.stdout.on('data', (chunk) => (output += chunk));
  child.stderr.on('data', (chunk) => (output += chunk));
  const code = await new Promise<number | null>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', resolve);
  });
  return { code, output };
}

describe('service integration collection and required gate', () => {
  it('executes health tests when the service is healthy', async () => {
    healthStatus = 'healthy';
    const result = await runHealthChecks(false);
    expect(result.output).toContain('2 passed');
    expect(result.code, result.output).toBe(0);
  });

  it('allows an optional local suite to skip an unhealthy service', async () => {
    healthStatus = 'degraded';
    const result = await runHealthChecks(false);
    expect(result.output).toContain('13 skipped');
    expect(result.code, result.output).toBe(0);
  });

  it('fails a required suite when the service is unhealthy', async () => {
    healthStatus = 'degraded';
    const result = await runHealthChecks(true);
    expect(result.output).toContain('service unavailable or unhealthy');
    expect(result.code, result.output).toBe(1);
  });

  it('fails a required run even when only some tests were skipped', async () => {
    healthStatus = 'healthy';
    const result = await runHealthChecks(true);
    expect(result.output).toContain('2 passed');
    expect(result.output).toContain('must execute tests without skips');
    expect(result.code, result.output).toBe(1);
  });
});
