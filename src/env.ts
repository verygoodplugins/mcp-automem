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
export function readAutoMemApiKeyFromEnv(
  env: NodeJS.ProcessEnv = process.env
): string | undefined {
  const candidates = [
    env.AUTOMEM_API_KEY,
    env.AUTOMEM_API_TOKEN,
    env.CLAUDE_PLUGIN_OPTION_API_KEY ?? env.CLAUDE_PLUGIN_OPTION_api_key,
    env.CLAUDE_PLUGIN_OPTION_API_TOKEN ?? env.CLAUDE_PLUGIN_OPTION_api_token,
  ];
  for (const candidate of candidates) {
    const value = String(candidate ?? "").trim();
    if (value) return value;
  }
  return undefined;
}

export const DEFAULT_AUTOMEM_API_URL = "http://127.0.0.1:8001";

export type AutoMemApiUrlSource =
  | "AUTOMEM_API_URL"
  | "CLAUDE_PLUGIN_OPTION_API_URL"
  | "AUTOMEM_ENDPOINT"
  | "default";

// Precedence: the documented env var beats the plugin prompt (a user who
// exports AUTOMEM_API_URL has configured explicitly); the plugin prompt
// beats the deprecated AUTOMEM_ENDPOINT; blank values fall through so a
// blind-accepted empty prompt never overrides a working legacy setup.
export function resolveAutoMemApiUrl(env: NodeJS.ProcessEnv = process.env): {
  url: string;
  source: AutoMemApiUrlSource;
} {
  const candidates: Array<[Exclude<AutoMemApiUrlSource, "default">, string | undefined]> = [
    ["AUTOMEM_API_URL", env.AUTOMEM_API_URL],
    [
      "CLAUDE_PLUGIN_OPTION_API_URL",
      env.CLAUDE_PLUGIN_OPTION_API_URL ?? env.CLAUDE_PLUGIN_OPTION_api_url,
    ],
    ["AUTOMEM_ENDPOINT", env.AUTOMEM_ENDPOINT],
  ];
  for (const [source, candidate] of candidates) {
    const value = String(candidate ?? "").trim();
    if (value) return { url: value, source };
  }
  return { url: DEFAULT_AUTOMEM_API_URL, source: "default" };
}
