// Provider-agnostic browser hand-off for cloud auth.
//
// The customer authorizes in a browser; the CLI never handles a password. When a
// provider supports an OAuth-style redirect we capture the token via an ephemeral
// 127.0.0.1 loopback server. When that's not possible (headless / CI / can't bind,
// or a provider that only offers a dashboard token page) we fall back to "open the
// page, paste the token once". The token is held in memory only — never persisted.

import { spawn } from 'node:child_process';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

// Best-effort "open this URL in the user's default browser". Detached + stdio
// ignored so it never blocks or pollutes the installer's output. Failures are
// swallowed — the paste fallback (and the printed URL) cover a no-op opener.
// AUTOMEM_NO_BROWSER=1 forces the no-op (headless servers, CI, the e2e demo) so the
// printed URL is the only hand-off.
export function openInSystemBrowser(url: string): void {
  if (process.env.AUTOMEM_NO_BROWSER) return;
  try {
    const platform = process.platform;
    const command = platform === 'darwin' ? 'open' : platform === 'win32' ? 'cmd' : 'xdg-open';
    const args = platform === 'win32' ? ['/c', 'start', '', url] : [url];
    const child = spawn(command, args, { stdio: 'ignore', detached: true });
    child.on('error', () => {});
    child.unref();
  } catch {
    /* opener unavailable — caller still prints the URL + offers paste */
  }
}

export interface CallbackServer {
  /** Loopback URL to register as the provider's redirect target. */
  redirectUri: string;
  /** Resolves with the token from the redirect, or rejects on timeout. */
  waitForToken(): Promise<string>;
  close(): void;
}

export type StartCallbackServer = (opts: {
  tokenParam: string;
  timeoutMs: number;
}) => Promise<CallbackServer>;

const DEFAULT_TIMEOUT_MS = 120_000;

// Add our loopback redirect target to the provider's authorize URL, preserving any
// params the provider already set (e.g. ref=jack).
export function buildAuthorizeUrl(
  authorizeUrl: string,
  redirectUri: string,
  redirectParam = 'redirect_uri'
): string {
  const url = new URL(authorizeUrl);
  url.searchParams.set(redirectParam, redirectUri);
  return url.toString();
}

// Pull the token out of a redirect request URL (path+query).
export function extractToken(requestUrl: string, tokenParam = 'token'): string | null {
  const url = new URL(requestUrl, 'http://127.0.0.1');
  return url.searchParams.get(tokenParam);
}

export async function startLoopbackCallbackServer(opts: {
  tokenParam: string;
  timeoutMs: number;
}): Promise<CallbackServer> {
  let resolveToken!: (token: string) => void;
  let rejectToken!: (err: Error) => void;
  const tokenPromise = new Promise<string>((resolve, reject) => {
    resolveToken = resolve;
    rejectToken = reject;
  });

  const server = http.createServer((req, res) => {
    const token = req.url ? extractToken(req.url, opts.tokenParam) : null;
    if (token) {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(
        '<!doctype html><meta charset="utf-8"><title>AutoMem</title>' +
          '<body style="font-family:system-ui;padding:2rem">' +
          '<h1>AutoMem connected</h1><p>You can close this tab and return to your terminal.</p></body>'
      );
      resolveToken(token);
    } else {
      res.writeHead(400, { 'content-type': 'text/plain' });
      res.end('Missing token');
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });

  const address = server.address() as AddressInfo;
  const redirectUri = `http://127.0.0.1:${address.port}/callback`;

  let timer: NodeJS.Timeout | undefined;
  if (opts.timeoutMs > 0) {
    timer = setTimeout(() => {
      rejectToken(
        new Error(`Browser authorization timed out after ${Math.round(opts.timeoutMs / 1000)}s.`)
      );
    }, opts.timeoutMs);
    // Don't keep the process alive solely for this timer.
    timer.unref?.();
  }

  return {
    redirectUri,
    waitForToken: () => tokenPromise,
    close: () => {
      if (timer) clearTimeout(timer);
      server.close();
    },
  };
}

export interface BrowserAuthorizeParams {
  /** Provider's base authorize URL (may already carry params like ref=jack). */
  authorizeUrl: string;
  /** Redirect query param carrying the token (default 'token'). */
  tokenParam?: string;
  /** Authorize-URL param to carry our loopback redirect (default 'redirect_uri'). */
  redirectParam?: string;
  openUrl?: (url: string) => void | Promise<void>;
  /** Paste fallback — wired to a masked prompt by the installer. */
  promptToken?: () => Promise<string>;
  /** Injectable for tests; defaults to the real loopback server. */
  startServer?: StartCallbackServer;
  /** Skip the loopback entirely (headless / CI / no TTY). */
  preferPaste?: boolean;
  timeoutMs?: number;
}

export interface BrowserAuthResult {
  token: string;
  method: 'callback' | 'paste';
}

export async function browserAuthorize(params: BrowserAuthorizeParams): Promise<BrowserAuthResult> {
  const tokenParam = params.tokenParam ?? 'token';
  const timeoutMs = params.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const startServer = params.startServer ?? startLoopbackCallbackServer;

  const paste = async (): Promise<BrowserAuthResult> => {
    if (!params.promptToken) {
      throw new Error('Browser authorization is unavailable and no paste fallback was provided.');
    }
    const token = (await params.promptToken()).trim();
    return { token, method: 'paste' };
  };

  if (params.preferPaste) {
    return paste();
  }

  let server: CallbackServer;
  try {
    server = await startServer({ tokenParam, timeoutMs });
  } catch {
    // Couldn't bind a loopback port — degrade gracefully.
    return paste();
  }

  try {
    const url = buildAuthorizeUrl(params.authorizeUrl, server.redirectUri, params.redirectParam);
    if (params.openUrl) await params.openUrl(url);
    const token = (await server.waitForToken()).trim();
    return { token, method: 'callback' };
  } catch {
    return paste();
  } finally {
    server.close();
  }
}
