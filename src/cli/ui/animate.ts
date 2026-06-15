// Progressive line-by-line reveal so the review/outro builds in instead of
// dumping all at once. Strictly cosmetic: on a non-TTY, or with NO_COLOR / CI /
// AUTOMEM_NO_ANIM set, it prints everything instantly so piped output, tests,
// and CI logs are unchanged.

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export function animationEnabled(
  stream: NodeJS.WriteStream = process.stdout,
  env: NodeJS.ProcessEnv = process.env
): boolean {
  if (stream.isTTY !== true) return false;
  if (env.NO_COLOR || env.CI || env.AUTOMEM_NO_ANIM) return false;
  return true;
}

export async function revealLines(
  text: string,
  options: { stream?: NodeJS.WriteStream; delayMs?: number; enabled?: boolean } = {}
): Promise<void> {
  const stream = options.stream ?? process.stdout;
  const enabled = options.enabled ?? animationEnabled(stream);
  if (!enabled) {
    stream.write(text.endsWith('\n') ? text : `${text}\n`);
    return;
  }
  const delayMs = options.delayMs ?? 14;
  const lines = text.split('\n');
  for (const line of lines) {
    stream.write(`${line}\n`);
    await sleep(delayMs);
  }
}
