#!/usr/bin/env node
// Adversarial mock AutoMem endpoint for installer e2e tests.
//
// Two ways to use it:
//   1. As a library:   import { createMock } from './mock-automem.mjs'
//                       const m = await createMock({ mode: 'healthy', expectToken: 'abc' });
//                       // m.url, m.requests[], await m.close()
//   2. As a CLI:        MOCK_MODE=healthy node mock-automem.mjs
//                       (prints "MOCK_LISTENING <url>" on stdout, logs requests to stderr)
//
// MODE controls behaviour so a single binary drives every scenario:
//   healthy   -> /health 200 {ok}, authed /recall 200
//   500       -> /health 500 (reachable but broken)
//   401       -> /health 200 but /recall 401 (bad/missing token path)
//   malformed -> /health 200 with non-JSON body and wrong content-type
import http from 'node:http';

/**
 * Start a mock AutoMem endpoint.
 * @param {{mode?: string, expectToken?: string, port?: number, onRequest?: Function}} opts
 * @returns {Promise<{url: string, port: number, requests: object[], close: () => Promise<void>}>}
 */
export function createMock(opts = {}) {
  const mode = opts.mode || 'healthy';
  const expectToken = opts.expectToken || '';
  const port = Number(opts.port ?? 0); // 0 => ephemeral
  const requests = [];

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const auth = req.headers.authorization || '';
    const token = auth.replace(/^Bearer\s+/i, '');
    const record = {
      method: req.method,
      path: url.pathname,
      search: url.search,
      authed: Boolean(auth),
      token,
    };
    requests.push(record);
    if (typeof opts.onRequest === 'function') opts.onRequest(record);

    if (url.pathname === '/health') {
      if (mode === '500') {
        res.writeHead(500, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ status: 'error' }));
      }
      if (mode === 'malformed') {
        res.writeHead(200, { 'content-type': 'text/html' });
        return res.end('<html>not json</html>');
      }
      // Real AutoMem /health returns status "healthy" (or "degraded" when Qdrant
      // is down) — never the literal "ok". The verify gate must accept any status
      // STRING, not a hardcoded value, so mirror the real shape here.
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ status: 'healthy', falkordb: 'connected', qdrant: 'connected' }));
    }

    if (url.pathname === '/recall') {
      if (mode === '401') {
        res.writeHead(401, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ error: 'unauthorized' }));
      }
      if (expectToken && token !== expectToken) {
        res.writeHead(401, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ error: 'bad token' }));
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ results: [] }));
    }

    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'not found' }));
  });

  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(port, '127.0.0.1', () => {
      const addr = server.address();
      resolve({
        url: `http://127.0.0.1:${addr.port}`,
        port: addr.port,
        requests,
        close: () =>
          new Promise((res) => server.close(() => res())),
      });
    });
  });
}

// CLI mode: only when run directly, not when imported.
const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const mode = process.env.MOCK_MODE || 'healthy';
  const expectToken = process.env.MOCK_EXPECT_TOKEN || '';
  const port = Number(process.env.MOCK_PORT || 0);
  const mock = await createMock({
    mode,
    expectToken,
    port,
    onRequest: (r) =>
      process.stderr.write(
        `[mock ${mode}] ${r.method} ${r.path}${r.search} auth=${r.authed ? 'yes' : 'no'}\n`
      ),
  });
  process.stdout.write(`MOCK_LISTENING ${mock.url}\n`);
  for (const sig of ['SIGINT', 'SIGTERM']) {
    process.on(sig, () => mock.close().then(() => process.exit(0)));
  }
}
