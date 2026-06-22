import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ensureRailwayCli,
  parsePodChoice,
  provisionViaInstaPodsLink,
  provisionViaRailway,
} from './installer-bridge.js';
import type { CloudDeployment, CloudProvider } from './types.js';

const promptMocks = vi.hoisted(() => ({
  promptSelect: vi.fn(async () => {
    throw new Error('promptSelect should not run');
  }),
  promptConfirm: vi.fn(async () => {
    throw new Error('promptConfirm should not run');
  }),
  promptPassword: vi.fn(async () => {
    throw new Error('promptPassword should not run');
  }),
  promptText: vi.fn(async () => {
    throw new Error('promptText should not run');
  }),
}));

vi.mock('../ui/prompts.js', () => ({
  cancelable: (promise: Promise<unknown>) => promise,
  ...promptMocks,
}));

const deployments: CloudDeployment[] = [
  { name: 'automem-prod', endpoint: 'https://automem-prod.example' },
  { name: 'automem-stg', endpoint: 'https://automem-stg.example' },
];

describe('parsePodChoice', () => {
  it('maps the deploy sentinel to a fresh-deploy intent', () => {
    expect(parsePodChoice('deploy', deployments)).toEqual({ kind: 'deploy' });
  });

  it('maps a reuse choice to the matching deployment', () => {
    expect(parsePodChoice('reuse:automem-stg', deployments)).toEqual({
      kind: 'reuse',
      deployment: deployments[1],
    });
  });

  it('falls back to deploy when the reuse target is unknown', () => {
    expect(parsePodChoice('reuse:ghost', deployments)).toEqual({ kind: 'deploy' });
  });
});

// The CLI-presence front-half: detect `railway`, offer to install it, or fall back.
// Everything is injected (is-present check, installer, consent) so no real system,
// prompt, or network is touched — mirrors railway.test.ts's RailwayCommandRunner fakes.
const okInstall = { code: 0, stdout: '', stderr: '' };

beforeEach(() => {
  Object.values(promptMocks).forEach((mock) => mock.mockClear());
});

describe('ensureRailwayCli', () => {
  it('reports present without prompting or installing when the CLI is on PATH', async () => {
    let installs = 0;
    let confirms = 0;
    const res = await ensureRailwayCli({
      interactive: true,
      isCliPresent: () => true,
      installCli: () => {
        installs += 1;
        return okInstall;
      },
      confirmInstall: async () => {
        confirms += 1;
        return true;
      },
      log: () => {},
    });
    expect(res).toEqual({ ok: true, via: 'present' });
    expect(installs).toBe(0);
    expect(confirms).toBe(0);
  });

  it('installs after consent when the CLI is absent, then reports installed', async () => {
    let installs = 0;
    let present = false; // absent until the install runs
    const res = await ensureRailwayCli({
      interactive: true,
      isCliPresent: () => present,
      installCli: () => {
        installs += 1;
        present = true;
        return okInstall;
      },
      confirmInstall: async () => true,
      log: () => {},
    });
    expect(res).toEqual({ ok: true, via: 'installed' });
    expect(installs).toBe(1);
  });

  it('does not install when the user declines the offer', async () => {
    let installs = 0;
    const res = await ensureRailwayCli({
      interactive: true,
      isCliPresent: () => false,
      installCli: () => {
        installs += 1;
        return okInstall;
      },
      confirmInstall: async () => false,
      log: () => {},
    });
    expect(res).toEqual({ ok: false, reason: 'declined' });
    expect(installs).toBe(0);
  });

  it('reports install-failed on a non-zero install exit', async () => {
    const res = await ensureRailwayCli({
      interactive: true,
      isCliPresent: () => false,
      installCli: () => ({ code: 1, stdout: '', stderr: 'EACCES: permission denied' }),
      confirmInstall: async () => true,
      log: () => {},
    });
    expect(res).toEqual({ ok: false, reason: 'install-failed' });
  });

  it('reports install-failed when the installer throws (e.g. npm missing)', async () => {
    const res = await ensureRailwayCli({
      interactive: true,
      isCliPresent: () => false,
      installCli: () => {
        throw new Error('spawn npm ENOENT');
      },
      confirmInstall: async () => true,
      log: () => {},
    });
    expect(res).toEqual({ ok: false, reason: 'install-failed' });
  });

  it('skips the install offer entirely when non-interactive (no prompt, no install)', async () => {
    let confirms = 0;
    let installs = 0;
    const res = await ensureRailwayCli({
      interactive: false,
      isCliPresent: () => false,
      installCli: () => {
        installs += 1;
        return okInstall;
      },
      confirmInstall: async () => {
        confirms += 1;
        return true;
      },
      log: () => {},
    });
    expect(res).toEqual({ ok: false, reason: 'non-interactive' });
    expect(confirms).toBe(0);
    expect(installs).toBe(0);
  });

  it('reports install-failed when install exits 0 but the CLI is still not on PATH', async () => {
    const res = await ensureRailwayCli({
      interactive: true,
      isCliPresent: () => false, // never flips to present
      installCli: () => okInstall, // exit 0, but PATH unchanged
      confirmInstall: async () => true,
      log: () => {},
    });
    expect(res).toEqual({ ok: false, reason: 'install-failed' });
  });
});

describe('provisionViaRailway routing', () => {
  function fakeProvider(
    creds = { endpoint: 'https://fake.example', apiKey: 'fake-key' },
    billing: CloudProvider['billing'] = { mode: 'free', planLabel: 'Free plan' }
  ): CloudProvider {
    return {
      id: 'fake',
      label: 'Fake',
      billing,
      async authorize() {
        return { token: 'tok' };
      },
      async listDeployments() {
        return [];
      },
      async deploy() {
        return { name: 'automem', status: 'DEPLOYED' };
      },
      async waitUntilReady(_session, deployment) {
        return deployment;
      },
      async fetchCredentials() {
        return creds;
      },
    };
  }

  it('flows into the guided provider path when the CLI is present', async () => {
    const result = await provisionViaRailway({
      interactive: true,
      provider: fakeProvider(),
      isCliPresent: () => true,
      log: () => {},
    });
    expect(result).toEqual({ endpoint: 'https://fake.example', apiKey: 'fake-key' });
  });

  it('does not touch the provider when the CLI is absent and non-interactive', async () => {
    let authorized = 0;
    const provider = fakeProvider();
    const guarded: CloudProvider = {
      ...provider,
      async authorize() {
        authorized += 1;
        return { token: 'tok' };
      },
    };
    // No CLI + no TTY: ensureRailwayCli must gate before the provider runs.
    await expect(
      provisionViaRailway({
        interactive: false,
        provider: guarded,
        isCliPresent: () => false,
        log: () => {},
      })
    ).rejects.toThrow(/railway cli/i);
    expect(authorized).toBe(0);
  });

  it('auto-confirms provider billing in non-interactive mode only when explicitly allowed', async () => {
    const result = await provisionViaRailway({
      interactive: false,
      autoConfirm: true,
      provider: fakeProvider(
        { endpoint: 'https://rw.example', apiKey: 'rw-key' },
        { mode: 'deferred', planLabel: 'Railway usage-based', priceLabel: '~$1-5/mo' }
      ),
      isCliPresent: () => true,
      log: () => {},
    });

    expect(result).toEqual({ endpoint: 'https://rw.example', apiKey: 'rw-key' });
    expect(promptMocks.promptConfirm).not.toHaveBeenCalled();
  });
});

describe('provisionViaInstaPodsLink routing', () => {
  it('rejects non-interactive setup before opening a prompt or browser', async () => {
    let opened = 0;

    await expect(
      provisionViaInstaPodsLink({
        interactive: false,
        log: () => {},
        openUrl: () => {
          opened += 1;
        },
      })
    ).rejects.toThrow(/requires a TTY/i);

    expect(opened).toBe(0);
    expect(promptMocks.promptSelect).not.toHaveBeenCalled();
    expect(promptMocks.promptText).not.toHaveBeenCalled();
    expect(promptMocks.promptPassword).not.toHaveBeenCalled();
  });
});
