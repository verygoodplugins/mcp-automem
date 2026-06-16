// Machine-output + safe-text helpers. `--json` paths use writeJson so no banner,
// color, or prose ever contaminates parseable output; truncate/escape keep
// human tables bounded and control-char-safe.

export function formatJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? 'null';
  } catch {
    return 'null';
  }
}

export function writeJson(value: unknown, stream: NodeJS.WriteStream = process.stdout): void {
  stream.write(`${formatJson(value)}\n`);
}

export function escapeCliText(value: string): string {
  return value.replace(/[\x00-\x1F\x7F]/g, (char) => {
    switch (char) {
      case '\n':
        return '\\n';
      case '\r':
        return '\\r';
      case '\t':
        return '\\t';
      default:
        return `\\x${char.charCodeAt(0).toString(16).padStart(2, '0')}`;
    }
  });
}

export function truncateCliText(value: string, maxLength: number): string {
  const escaped = escapeCliText(value);
  if (escaped.length <= maxLength) return escaped;
  return `${escaped.slice(0, Math.max(0, maxLength - 3))}...`;
}

export function joinCliList(
  values: string[],
  options: { empty?: string; maxItemLength?: number; maxItems?: number } = {}
): string {
  const empty = options.empty ?? 'none';
  if (values.length === 0) return empty;
  const maxItems = options.maxItems ?? values.length;
  const shown = values
    .slice(0, maxItems)
    .map((value) => truncateCliText(value, options.maxItemLength ?? 80));
  const hidden = values.length - shown.length;
  return hidden > 0 ? `${shown.join(', ')}, +${hidden} more` : shown.join(', ');
}
