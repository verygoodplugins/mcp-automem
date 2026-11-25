import fs from 'node:fs';

// CLAUDE_PLUGIN_OPTION_* vars carry the Claude Code plugin's userConfig
// answers. Claude Code does not pass plugin options to a stdio MCP server by
// itself: plugins/automem/.mcp.json maps them into the server's environment as
// CLAUDE_PLUGIN_OPTION_API_URL / CLAUDE_PLUGIN_OPTION_API_KEY, and an unset
// option arrives as an empty string. AUTOMEM_* names stay out of .mcp.json: a
// config-level AUTOMEM_API_URL would shadow a user's own environment, including
// a legacy AUTOMEM_ENDPOINT (see tests/installer/plugin-mcp-config.test.ts).
// The lower-case spellings are still accepted for hosts that export them.
//
// Canonical name is AUTOMEM_API_KEY (matches the AutoMem service docs + repo,
// which are standardizing on _KEY). AUTOMEM_API_TOKEN is the deprecated alias,
// still read so the Railway template / SSE sidecar / existing deploys (which set
// AUTOMEM_API_TOKEN) keep working.

// A host that does not expand .mcp.json would hand the server the literal
// `${user_config.api_key}`. A value that is exactly one such placeholder is
// treated as blank; a real value that merely contains `${` is kept.
const UNEXPANDED_PLACEHOLDER = /^\$\{[^}]*\}$/;

// The first of the upper-case then lower-case spelling that is non-blank after
// the placeholder rule, so a blank upper-case value never hides a real one.
function readPluginOption(env: NodeJS.ProcessEnv, upper: string, lower: string): string {
  for (const name of [upper, lower]) {
    const value = String(env[name] ?? '').trim();
    if (value && !UNEXPANDED_PLACEHOLDER.test(value)) return value;
  }
  return '';
}

function firstNonBlank(candidates: Array<string | undefined>): string | undefined {
  for (const candidate of candidates) {
    const value = String(candidate ?? '').trim();
    if (value) return value;
  }
  return undefined;
}

/** AUTOMEM_API_KEY, then the deprecated AUTOMEM_API_TOKEN. */
function readEnvironmentApiKey(env: NodeJS.ProcessEnv): string | undefined {
  return firstNonBlank([env.AUTOMEM_API_KEY, env.AUTOMEM_API_TOKEN]);
}

/** The plugin's api_key option, under any spelling the server accepts. */
function readPluginApiKey(env: NodeJS.ProcessEnv): string | undefined {
  return firstNonBlank([
    readPluginOption(env, 'CLAUDE_PLUGIN_OPTION_API_KEY', 'CLAUDE_PLUGIN_OPTION_api_key'),
    readPluginOption(env, 'CLAUDE_PLUGIN_OPTION_API_TOKEN', 'CLAUDE_PLUGIN_OPTION_api_token'),
  ]);
}

/**
 * Any key the environment carries, without checking which endpoint it belongs
 * to. The server itself uses resolveAutoMemApiKey, which pairs the plugin key
 * with the plugin URL.
 */
export function readAutoMemApiKeyFromEnv(env: NodeJS.ProcessEnv = process.env): string | undefined {
  return readEnvironmentApiKey(env) ?? readPluginApiKey(env);
}

export const DEFAULT_AUTOMEM_API_URL = 'http://127.0.0.1:8001';

export type AutoMemApiUrlSource =
  'AUTOMEM_API_URL' | 'CLAUDE_PLUGIN_OPTION_API_URL' | 'AUTOMEM_ENDPOINT' | 'default';

// Precedence: the documented env var beats the plugin option (a user who
// exports AUTOMEM_API_URL, or sets it in the project .env, has configured
// explicitly); the plugin option beats the deprecated AUTOMEM_ENDPOINT; the
// localhost default comes last. Blank values fall through so an unset option
// never overrides a working legacy setup.
export function resolveAutoMemApiUrl(env: NodeJS.ProcessEnv = process.env): {
  url: string;
  source: AutoMemApiUrlSource;
} {
  const candidates: Array<[Exclude<AutoMemApiUrlSource, 'default'>, string | undefined]> = [
    ['AUTOMEM_API_URL', env.AUTOMEM_API_URL],
    [
      'CLAUDE_PLUGIN_OPTION_API_URL',
      readPluginOption(env, 'CLAUDE_PLUGIN_OPTION_API_URL', 'CLAUDE_PLUGIN_OPTION_api_url'),
    ],
    ['AUTOMEM_ENDPOINT', env.AUTOMEM_ENDPOINT],
  ];
  for (const [source, candidate] of candidates) {
    const value = String(candidate ?? '').trim();
    if (value) return { url: value, source };
  }
  return { url: DEFAULT_AUTOMEM_API_URL, source: 'default' };
}

/** An endpoint spelling with surrounding whitespace and trailing slashes removed. */
export function normalizeAutoMemEndpoint(value: string): string {
  return value.trim().replace(/\/+$/, '');
}

/**
 * Whether two endpoint spellings address the same server, as the API client
 * sees it: AutoMemClient strips a trailing slash, so `https://x` and
 * `https://x/` match. This compares the normalized strings; it does not parse
 * URLs or fold case. An empty side never matches.
 */
export function sameAutoMemEndpoint(a: string, b: string): boolean {
  return Boolean(a) && Boolean(b) && normalizeAutoMemEndpoint(a) === normalizeAutoMemEndpoint(b);
}

/**
 * The key the server should send to the URL in use.
 *
 * An environment key (AUTOMEM_API_KEY, then AUTOMEM_API_TOKEN) always wins: a
 * user who exports one has chosen it. Otherwise the plugin key is used unless
 * the plugin also has a URL and the URL in use is a different endpoint (for
 * example AUTOMEM_API_URL names a hosted server while the plugin was set up for
 * a local one). That keeps a key saved for one server from being sent to
 * another. A plugin key with no plugin URL is bound to nothing, so it stands.
 */
export function resolveAutoMemApiKey(
  env: NodeJS.ProcessEnv = process.env,
  url: { url: string; source: AutoMemApiUrlSource } = resolveAutoMemApiUrl(env)
): string | undefined {
  const environmentKey = readEnvironmentApiKey(env);
  if (environmentKey) return environmentKey;
  const pluginKey = readPluginApiKey(env);
  if (!pluginKey) return undefined;
  const pluginUrl = readPluginOption(
    env,
    'CLAUDE_PLUGIN_OPTION_API_URL',
    'CLAUDE_PLUGIN_OPTION_api_url'
  );
  if (pluginUrl && !sameAutoMemEndpoint(pluginUrl, url.url)) return undefined;
  return pluginKey;
}

/**
 * Whether resolveAutoMemApiKey is withholding the plugin key: there is no
 * environment key, the plugin has both a key and a URL, and the URL in use is
 * a different endpoint. The server warns once at startup when this is true.
 */
export function isPluginApiKeyWithheld(
  env: NodeJS.ProcessEnv = process.env,
  url: { url: string; source: AutoMemApiUrlSource } = resolveAutoMemApiUrl(env)
): boolean {
  return (
    !readEnvironmentApiKey(env) &&
    Boolean(readPluginApiKey(env)) &&
    resolveAutoMemApiKey(env, url) === undefined
  );
}

/**
 * Whether a legacy AUTOMEM_ENDPOINT is being outranked by the plugin's saved
 * API URL (the precedence in resolveAutoMemApiUrl). The plugin URL only reaches
 * the server through the plugin's .mcp.json mapping, so a user with an old
 * saved plugin URL and AUTOMEM_ENDPOINT may be moved without noticing; the
 * server warns once at startup when this is true.
 */
export function isLegacyEndpointShadowedByPlugin(
  env: NodeJS.ProcessEnv = process.env,
  url: { url: string; source: AutoMemApiUrlSource } = resolveAutoMemApiUrl(env)
): boolean {
  if (url.source !== 'CLAUDE_PLUGIN_OPTION_API_URL') return false;
  const legacy = String(env.AUTOMEM_ENDPOINT ?? '').trim();
  return Boolean(legacy) && !sameAutoMemEndpoint(legacy, url.url);
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
/** Local plugin connection stored separately from the MCP manifest and process env. */
export function readAutoMemConnectionFile(
  env: NodeJS.ProcessEnv = process.env
): { endpoint: string; apiKey?: string } | undefined {
  const file = env.AUTOMEM_CONNECTION_FILE;
  if (!file) return undefined;
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
    const record = parsed as Record<string, unknown>;
    if (
      typeof record.endpoint !== 'string' ||
      !record.endpoint.trim() ||
      (record.apiKey !== undefined && typeof record.apiKey !== 'string')
    )
      throw new Error();
    const url = new URL(record.endpoint);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error();
    return {
      endpoint: record.endpoint,
      apiKey: typeof record.apiKey === 'string' && record.apiKey ? record.apiKey : undefined,
    };
  } catch {
    // Never include the file contents or parser errors, which can contain secrets.
    throw new Error(
      'The AutoMem connection file is missing or invalid. Re-run the AutoMem installer.'
    );
  }
}
