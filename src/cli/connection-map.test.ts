import { describe, expect, it } from 'vitest';
import { renderConnectionMap } from './connection-map.js';
import { makeTheme } from './ui/theme.js';

const plain = makeTheme(process.stdout, { color: 'never', symbols: 'ascii' });

describe('renderConnectionMap', () => {
  it('draws tools → AutoMem → storage for a local install', () => {
    const map = renderConnectionMap({
      clients: ['cursor', 'claude-code'],
      endpoint: 'http://127.0.0.1:8001',
      local: true,
      theme: plain,
    });
    expect(map).toContain('Cursor, Claude Code');
    expect(map).toContain('AutoMem  http://127.0.0.1:8001');
    expect(map).toContain('in Docker on this computer');
    expect([...map].every((char) => char.charCodeAt(0) < 128)).toBe(true);
  });

  it('describes a hosted server and an empty tool list', () => {
    const map = renderConnectionMap({
      clients: [],
      endpoint: 'https://memory.example',
      local: false,
      theme: makeTheme(process.stdout, { color: 'never', symbols: 'unicode' }),
    });
    expect(map).toContain('no AI tool yet');
    expect(map).toContain('on your host');
    expect(map).toContain('▼');
  });
});
