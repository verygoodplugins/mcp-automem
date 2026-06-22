import { describe, expect, it } from 'vitest';
import {
  browserAuthorize,
  buildAuthorizeUrl,
  extractToken,
  startLoopbackCallbackServer,
  type CallbackServer,
  type StartCallbackServer,
} from './browser-auth.js';

describe('buildAuthorizeUrl', () => {
  it('appends the redirect_uri, URL-encoded, preserving existing query params', () => {
    const url = buildAuthorizeUrl(
      'https://app.instapods.com/authorize?ref=jack',
      'http://127.0.0.1:54321/callback'
    );
    const parsed = new URL(url);
    expect(parsed.searchParams.get('ref')).toBe('jack');
    expect(parsed.searchParams.get('redirect_uri')).toBe('http://127.0.0.1:54321/callback');
  });

  it('honors a custom redirect param name', () => {
    const url = buildAuthorizeUrl('https://x.example/auth', 'http://127.0.0.1:9/cb', 'cb');
    expect(new URL(url).searchParams.get('cb')).toBe('http://127.0.0.1:9/cb');
  });
});

describe('extractToken', () => {
  it('reads the token query param from a redirect request URL', () => {
    expect(extractToken('/callback?token=abc123', 'token')).toBe('abc123');
  });

  it('returns null when the token param is absent', () => {
    expect(extractToken('/callback?other=1', 'token')).toBeNull();
  });
});

function fakeServer(token: string | Promise<string>): { start: StartCallbackServer; closed: () => boolean } {
  let closed = false;
  const server: CallbackServer = {
    redirectUri: 'http://127.0.0.1:5999/callback',
    waitForToken: async () => token,
    close: () => {
      closed = true;
    },
  };
  return { start: async () => server, closed: () => closed };
}

describe('browserAuthorize', () => {
  it('captures the token via the loopback callback and opens the authorize URL', async () => {
    const opened: string[] = [];
    const { start } = fakeServer('tok-callback');

    const result = await browserAuthorize({
      authorizeUrl: 'https://app.instapods.com/authorize?ref=jack',
      openUrl: (u) => {
        opened.push(u);
      },
      startServer: start,
    });

    expect(result).toEqual({ token: 'tok-callback', method: 'callback' });
    expect(opened).toHaveLength(1);
    expect(new URL(opened[0]).searchParams.get('redirect_uri')).toBe('http://127.0.0.1:5999/callback');
  });

  it('uses the paste fallback (and never starts a server) when preferPaste is set', async () => {
    let serverStarted = false;
    const start: StartCallbackServer = async () => {
      serverStarted = true;
      throw new Error('should not start');
    };

    const result = await browserAuthorize({
      authorizeUrl: 'https://x.example/auth',
      preferPaste: true,
      promptToken: async () => 'tok-pasted',
      startServer: start,
    });

    expect(serverStarted).toBe(false);
    expect(result).toEqual({ token: 'tok-pasted', method: 'paste' });
  });

  it('falls back to paste and closes the server when the callback times out', async () => {
    const rejecting = fakeServer(Promise.reject(new Error('timed out')));

    const result = await browserAuthorize({
      authorizeUrl: 'https://x.example/auth',
      openUrl: () => {},
      startServer: rejecting.start,
      promptToken: async () => 'tok-after-timeout',
    });

    expect(result).toEqual({ token: 'tok-after-timeout', method: 'paste' });
    expect(rejecting.closed()).toBe(true);
  });
});

describe('startLoopbackCallbackServer (real boundary)', () => {
  it('binds 127.0.0.1 and resolves the token from a real redirect hit', async () => {
    const server = await startLoopbackCallbackServer({ tokenParam: 'token', timeoutMs: 5000 });
    try {
      const tokenPromise = server.waitForToken();
      const res = await fetch(`${server.redirectUri}?token=real-xyz`);
      expect(res.ok).toBe(true);
      await expect(tokenPromise).resolves.toBe('real-xyz');
    } finally {
      server.close();
    }
  });
});
