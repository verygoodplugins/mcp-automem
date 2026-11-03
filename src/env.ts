// CLAUDE_PLUGIN_OPTION_* vars carry the Claude Code plugin's userConfig
// answers (exported by Claude Code to plugin subprocesses). The server reads
// them here instead of the plugin wiring them through .mcp.json env, where a
// config-level AUTOMEM_API_URL would shadow a legacy user's AUTOMEM_ENDPOINT
// (see tests/installer/plugin-mcp-config.test.ts). The exported key casing is
// not pinned by the docs, so both spellings are accepted.
//
// Canonical name is AUTOMEM_API_KEY (matches the AutoMem service docs + repo,
// which are standardizing on _KEY). AUTOMEM_API_TOKEN is the deprecated alias,
// still read so the Railway template / SSE sidecar / existing deploys (which set
// AUTOMEM_API_TOKEN) keep working.
export function readAutoMemApiKeyFromEnv(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const candidates = [
    env.AUTOMEM_API_KEY,
    env.AUTOMEM_API_TOKEN,
    env.CLAUDE_PLUGIN_OPTION_API_KEY ?? env.CLAUDE_PLUGIN_OPTION_api_key,
    env.CLAUDE_PLUGIN_OPTION_API_TOKEN ?? env.CLAUDE_PLUGIN_OPTION_api_token,
  ];
  for (const candidate of candidates) {
    const value = String(candidate ?? '').trim();
    if (value) return value;
  }
  return undefined;
}

export const DEFAULT_AUTOMEM_API_URL = 'http://127.0.0.1:8001';

export type AutoMemApiUrlSource =
  'AUTOMEM_API_URL' | 'CLAUDE_PLUGIN_OPTION_API_URL' | 'AUTOMEM_ENDPOINT' | 'default';

// Precedence: the documented env var beats the plugin prompt (a user who
// exports AUTOMEM_API_URL has configured explicitly); the plugin prompt
// beats the deprecated AUTOMEM_ENDPOINT; blank values fall through so a
// blind-accepted empty prompt never overrides a working legacy setup.
export function resolveAutoMemApiUrl(env: NodeJS.ProcessEnv = process.env): {
  url: string;
  source: AutoMemApiUrlSource;
} {
  const candidates: Array<[Exclude<AutoMemApiUrlSource, 'default'>, string | undefined]> = [
    ['AUTOMEM_API_URL', env.AUTOMEM_API_URL],
    [
      'CLAUDE_PLUGIN_OPTION_API_URL',
      env.CLAUDE_PLUGIN_OPTION_API_URL ?? env.CLAUDE_PLUGIN_OPTION_api_url,
    ],
    ['AUTOMEM_ENDPOINT', env.AUTOMEM_ENDPOINT],
  ];
  for (const [source, candidate] of candidates) {
    const value = String(candidate ?? '').trim();
    if (value) return { url: value, source };
  }
  return { url: DEFAULT_AUTOMEM_API_URL, source: 'default' };
}

// The remote MCP sidecar (automem/mcp-sse-server) is a separate service from
// the REST API this server talks to, and only process-less clients need it.
// Its /health answers 200 with a `status`, so a sidecar URL pasted into
// AUTOMEM_API_URL passes a naive health check and then every REST call 404s.
// The payload is the reliable signal: the sidecar advertises `transports` and
// `endpoints`, which the REST API's /health never returns. A bare sidecar
// host has no /mcp suffix, so the path check is only a second signal.
export const MCP_SIDECAR_FIX =
  "use the AutoMem API base URL instead; the sidecar's /mcp URL is for remote MCP clients only";

// A body with `falkordb` or `qdrant` is the REST API's own /health, so a later
// REST release that advertises the MCP URL under `endpoints` is not flagged.
export function isMcpSidecarHealth(body: unknown): boolean {
  if (!body || typeof body !== 'object') return false;
  if ('falkordb' in body || 'qdrant' in body) return false;
  return 'endpoints' in body || 'transports' in body;
}

export function hasMcpSidecarPath(url: string): boolean {
  let pathname: string;
  try {
    pathname = new URL(url).pathname;
  } catch {
    return false;
  }
  return /\/mcp(\/sse)?\/?$/i.test(pathname);
}
