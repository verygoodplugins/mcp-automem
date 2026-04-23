export type OpenClawRecallLikeResult = {
  id?: string;
  memory?: {
    memory_id?: string;
    id?: string;
    content?: string;
    tags?: string[];
    type?: string;
  };
};

function compactText(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 3)}...` : normalized;
}

export function formatOpenClawRecallContext(result: OpenClawRecallLikeResult): string {
  const content = compactText(String(result.memory?.content || ''), 220);
  const tags = Array.isArray(result.memory?.tags) && result.memory.tags.length > 0
    ? ` [tags: ${result.memory.tags.slice(0, 4).join(', ')}]`
    : '';
  const type = result.memory?.type ? `[${result.memory.type}] ` : '';
  return `- ${type}${content}${tags}`;
}

export function dedupeOpenClawRecallResults<T extends OpenClawRecallLikeResult>(results: T[]): T[] {
  const seen = new Set<string>();
  return results.filter((entry) => {
    const key = entry.id || entry.memory?.memory_id || entry.memory?.id || JSON.stringify(entry.memory || {});
    if (!key || seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

export function looksLikeOpenClawProfileCue(result: OpenClawRecallLikeResult): boolean {
  const content = String(result.memory?.content || '').toLowerCase();
  const tags = Array.isArray(result.memory?.tags)
    ? result.memory.tags.map((tag) => String(tag).toLowerCase())
    : [];
  const type = String(result.memory?.type || '').toLowerCase();
  const haystack = [content, type, ...tags].join(' ');
  return /(name|preferred|timezone|profile|identity|style|pronoun|call me|i am|user|tone|personality|voice)/.test(haystack);
}

export function buildStartupProfileFromResults(
  results: OpenClawRecallLikeResult[],
  options?: { maxEntries?: number }
): string | undefined {
  const uniqueResults = dedupeOpenClawRecallResults(results);
  const preferred = uniqueResults.filter((entry) => looksLikeOpenClawProfileCue(entry));
  const selected = (preferred.length > 0 ? preferred : uniqueResults).slice(0, options?.maxEntries ?? 4);
  if (selected.length === 0) {
    return undefined;
  }

  return selected
    .map((entry) => formatOpenClawRecallContext(entry))
    .join('\n');
}

export function buildOpenClawStartupContext(params: {
  startupProfile?: string;
  startupResults: OpenClawRecallLikeResult[];
}): string {
  const profileSection = params.startupProfile?.trim()
    ? `Cached startup profile:\n${params.startupProfile.trim()}`
    : '';
  const resultSection = params.startupResults.length > 0
    ? `Recovered startup context:\n${params.startupResults
        .map((entry) => formatOpenClawRecallContext(entry))
        .join('\n')}`
    : '';
  const hasProfileCue =
    Boolean(params.startupProfile?.trim()) ||
    params.startupResults.some((entry) => looksLikeOpenClawProfileCue(entry));
  const guidance = hasProfileCue
    ? 'Bootstrap is disabled for this workspace. Do not run a bootstrap questionnaire. Treat this as a returning conversation and greet naturally using the recovered identity, personality, and profile details when relevant.'
    : 'Bootstrap is disabled for this workspace. Do not run a bootstrap questionnaire. Use a generic greeting unless the user volunteers profile details.';
  const sections = [guidance, profileSection, resultSection].filter(Boolean);
  return `<automem-startup>\n${sections.join('\n\n')}\n</automem-startup>`;
}
