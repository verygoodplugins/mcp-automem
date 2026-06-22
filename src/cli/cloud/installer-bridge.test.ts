import { describe, expect, it } from 'vitest';
import { parsePodChoice } from './installer-bridge.js';
import type { CloudDeployment } from './types.js';

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
