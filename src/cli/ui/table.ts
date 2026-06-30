import { padEndVisible, type Theme, visibleLength } from './theme.js';

export type TableRow = {
  label: string;
  value: string;
  status?: 'ok' | 'warn' | 'error' | 'muted';
};

export function statusMark(theme: Theme, status: TableRow['status'] = 'muted'): string {
  switch (status) {
    case 'ok':
      return theme.style.gold(theme.symbol.check);
    case 'warn':
      return theme.style.yellow(theme.symbol.warn);
    case 'error':
      return theme.style.red(theme.symbol.cross);
    case 'muted':
      return theme.style.dim(theme.symbol.bullet);
  }
}

export function keyValueRows(rows: TableRow[], theme: Theme, indent = '  '): string {
  if (rows.length === 0) return '';
  const labelWidth = Math.min(18, Math.max(...rows.map((row) => visibleLength(row.label)), 4));
  return rows
    .map((row) => {
      const label = padEndVisible(theme.style.dim(row.label), labelWidth);
      return `${indent}${statusMark(theme, row.status)} ${label} ${row.value}`;
    })
    .join('\n');
}

export function bulletList(items: string[], theme: Theme, indent = '  '): string {
  return items
    .map((item) => `${indent}${theme.style.dim(theme.symbol.bullet)} ${item}`)
    .join('\n');
}
