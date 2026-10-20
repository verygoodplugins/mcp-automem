import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { HOST_SMOKE_SPECS } from '../helpers/host-specs.js';

function hasCopilotCli(): boolean {
  return spawnSync('copilot', ['--version'], { encoding: 'utf8', timeout: 5_000 }).status === 0;
}

function runCopilot(home: string, args: string[]) {
  return spawnSync('copilot', args, {
    encoding: 'utf8',
    timeout: 15_000,
    env: { ...process.env, COPILOT_HOME: home },
  });
}

describe.runIf(hasCopilotCli())('Copilot CLI real MCP configuration boundary', () => {
  const homes: string[] = [];

  afterEach(() => {
    for (const home of homes.splice(0)) {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  it('registers an AutoMem stdio server through Copilot CLI with all tools enabled', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'automem-copilot-host-'));
    homes.push(home);
    const spec = HOST_SMOKE_SPECS.find((candidate) => candidate.host === 'copilot-cli')!;

    const added = runCopilot(home, [
      'mcp',
      'add',
      '--json',
      '--tools',
      '*',
      'automem',
      '--',
      'node',
      '--version',
    ]);
    expect(added.status, added.stderr).toBe(0);

    const inspected = runCopilot(home, ['mcp', 'get', 'automem', '--json']);
    expect(inspected.status, inspected.stderr).toBe(0);
    expect(JSON.stringify(JSON.parse(inspected.stdout))).toContain('automem');
    expect(JSON.stringify(JSON.parse(inspected.stdout))).toContain('node');
    expect(spec.expectedToolNames).toEqual([
      'automem-associate_memories',
      'automem-check_database_health',
      'automem-delete_memory',
      'automem-recall_memory',
      'automem-store_memory',
      'automem-update_memory',
    ]);
  });
});
