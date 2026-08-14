import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';
import {
  AGENT_CLIENTS,
  STANDALONE_PLATFORMS,
  UNINSTALL_PLATFORMS,
  UNINSTALL_UNSUPPORTED_CLIENTS,
  type AgentClient,
} from '../../src/cli/clients.js';
import { HOST_SMOKE_SPECS } from '../helpers/host-specs.js';

/**
 * Adding a host used to mean updating six independent hand-maintained lists, and only
 * one of them was type-checked. The gaps that produced — OpenClaw installable but not
 * uninstallable, Grok missing from the policy generator, Copilot missing from the CLI's
 * known-commands set — were all invisible until someone tripped over them.
 *
 * These assertions turn each of those edges into a test failure. Where a gap is
 * knowingly accepted, it belongs in an exclusion list here with a reason, not in silence.
 */

const REPO_ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

function readRepoFile(relativePath: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), 'utf8');
}

/**
 * Hosts whose memory rules are still hand-written instead of rendered from
 * src/memory-policy/shared.ts. Copilot is known debt: #186 ("prefix CLI memory rule
 * tool calls") was exactly the drift this list exists to make visible. Removing an
 * entry here is the point — do not add one to make a failure go away.
 */
const HAND_WRITTEN_RULES: readonly string[] = ['copilot'];

/** Rules artifact each client's installer reads, when it ships one. */
const RULES_TEMPLATES: Partial<Record<AgentClient | 'copilot', string>> = {
  codex: 'templates/codex/memory-rules.md',
  cursor: 'templates/cursor/automem.mdc.template',
  hermes: 'templates/hermes/memory-rules.md',
  grok: 'templates/grok/memory-rules.md',
  copilot: 'templates/COPILOT_INSTRUCTIONS_MEMORY_RULES.md',
};

describe('host integration parity', () => {
  it('gives every installer client an uninstall path or a documented exclusion', () => {
    for (const client of AGENT_CLIENTS) {
      const uninstallable = (UNINSTALL_PLATFORMS as readonly string[]).includes(client);
      const excluded = (UNINSTALL_UNSUPPORTED_CLIENTS as readonly string[]).includes(client);
      expect(
        uninstallable || excluded,
        `AGENT_CLIENTS includes '${client}' but it has no uninstall path. ` +
          'Add one in src/cli/uninstall.ts, or list it in UNINSTALL_UNSUPPORTED_CLIENTS with a reason.'
      ).toBe(true);
      expect(
        uninstallable && excluded,
        `'${client}' is both uninstallable and listed as unsupported — drop it from UNINSTALL_UNSUPPORTED_CLIENTS.`
      ).toBe(false);
    }
  });

  it('routes every uninstall platform through the uninstall command', () => {
    const source = readRepoFile('src/cli/uninstall.ts');
    for (const platform of UNINSTALL_PLATFORMS) {
      expect(
        source.includes(`options.platform === '${platform}'`),
        `uninstall accepts '${platform}' but runUninstall never dispatches it.`
      ).toBe(true);
    }
  });

  it('gives every installer client at least one host smoke spec', () => {
    const covered = new Set(HOST_SMOKE_SPECS.map((spec) => spec.client));
    for (const client of AGENT_CLIENTS) {
      const excluded = (UNINSTALL_UNSUPPORTED_CLIENTS as readonly string[]).includes(client);
      if (excluded) continue; // No uninstall path yet, so no meaningful round-trip to smoke.
      expect(
        covered.has(client),
        `AGENT_CLIENTS includes '${client}' but tests/helpers/host-specs.ts has no spec for it.`
      ).toBe(true);
    }
    for (const platform of STANDALONE_PLATFORMS) {
      expect(
        covered.has(platform),
        `'${platform}' ships setup and uninstall commands but has no host smoke spec.`
      ).toBe(true);
    }
  });

  it('describes each registration surface exactly once', () => {
    // Surfaces are keyed by host id; a duplicate means two entries are silently
    // competing to define the same contract. (Tool names are deliberately *not*
    // unique across surfaces — Codex and Claude Code both use `mcp__memory__*`.)
    const seen = new Set<string>();
    for (const spec of HOST_SMOKE_SPECS) {
      expect(seen.has(spec.host), `Duplicate host smoke spec for '${spec.host}'.`).toBe(false);
      seen.add(spec.host);
    }
  });

  it('ties every host smoke spec to a real client', () => {
    const known = new Set<string>([...AGENT_CLIENTS, ...STANDALONE_PLATFORMS]);
    for (const spec of HOST_SMOKE_SPECS) {
      expect(
        known.has(spec.client),
        `Host '${spec.host}' claims client '${spec.client}', which is neither an AgentClient nor a standalone platform.`
      ).toBe(true);
    }
  });

  it('generates every shipped rules template from the shared memory policy', () => {
    const sync = readRepoFile('scripts/sync-memory-policy.ts');
    for (const [client, template] of Object.entries(RULES_TEMPLATES)) {
      if (!template) continue;
      expect(
        fs.existsSync(path.join(REPO_ROOT, template)),
        `RULES_TEMPLATES points '${client}' at ${template}, which does not exist.`
      ).toBe(true);

      if (HAND_WRITTEN_RULES.includes(client)) {
        // Assert the debt is real, so this entry disappears when the host is migrated.
        expect(
          sync.includes(template),
          `'${client}' is listed in HAND_WRITTEN_RULES but ${template} is now generated — remove it from that list.`
        ).toBe(false);
        continue;
      }

      expect(
        sync.includes(template),
        `${template} is not registered in scripts/sync-memory-policy.ts, so it will silently drift ` +
          'from src/memory-policy/shared.ts. Add a renderer, or list the client in HAND_WRITTEN_RULES.'
      ).toBe(true);
    }
  });

  it('recognizes every routed host setup command in the CLI', () => {
    const source = readRepoFile('src/index.ts');
    for (const command of [...AGENT_CLIENTS, ...STANDALONE_PLATFORMS]) {
      expect(
        source.includes(`command === '${command}'`),
        `'${command}' is a known command but src/index.ts never routes it.`
      ).toBe(true);
    }
  });
});
