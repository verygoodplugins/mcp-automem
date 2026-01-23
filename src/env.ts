export function readAutoMemApiKeyFromEnv(
  env: NodeJS.ProcessEnv = process.env
): string | undefined {
  const candidates = [env.AUTOMEM_API_KEY, env.AUTOMEM_API_TOKEN];
  for (const candidate of candidates) {
    const value = String(candidate ?? "").trim();
    if (value) return value;
  }
  return undefined;
}

