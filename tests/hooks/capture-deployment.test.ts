/**
 * Tests for templates/claude-code/hooks/capture-deployment.sh
 *
 * The deploy matcher is the highest-risk hook because it overmatched in prior
 * versions (any Bash command containing "railway" or "docker" triggered a
 * capture, polluting the memory graph with things like `curl https://x.up.railway.app/health`
 * or `docker ps`). These tests lock in the tight matcher AND the bare-tag
 * emission required by the corpus convention.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, findNamespaceTags, runCaptureHook, VALID_TYPES } from './helpers';

describe('capture-deployment.sh', () => {
  const homes: string[] = [];
  afterEach(() => {
    while (homes.length) cleanup(homes.pop()!);
  });

  function run(input: Parameters<typeof runCaptureHook>[1]) {
    const result = runCaptureHook('capture-deployment.sh', input);
    homes.push(result.home);
    return result;
  }

  describe('matcher — must NOT fire for read-only commands', () => {
    it.each([
      ['curl against a railway URL', 'curl https://my-app.up.railway.app/health'],
      ['wget from a vercel URL', 'wget https://my-app.vercel.app/api/users'],
      ['docker ps (status check)', 'docker ps'],
      ['kubectl get pods (status check)', 'kubectl get pods -n prod'],
      ['aws s3 ls (listing, not deploy)', 'aws s3 ls s3://mybucket'],
      ['grep for the word "deploy" in a file', 'grep deploy src/app.ts'],
      ['cat a deploy log', 'cat /var/log/deploy.log'],
      ['random railway-containing filename', 'ls railway-config/'],
    ])('skips: %s', (_label, command) => {
      const result = run({ command });
      expect(result.queue).toHaveLength(0);
      expect(result.exitCode).toBe(0);
    });
  });

  describe('matcher — MUST fire for real deploy actions', () => {
    it.each([
      ['railway up', 'railway up --service api', 'railway'],
      ['vercel deploy --prod', 'vercel deploy --prod', 'vercel'],
      ['netlify deploy', 'netlify deploy --prod', 'netlify'],
      ['kubectl apply', 'kubectl apply -f deployment.yaml', 'kubernetes'],
      ['firebase deploy', 'firebase deploy --only hosting', 'gcp'],
      ['custom deploy script', './deploy.sh production', 'unknown'],
    ])('captures: %s', (_label, command, expectedPlatform) => {
      const result = run({
        command,
        exitCode: 0,
        output: `Deploy complete: https://example.com (v1.2.3)`,
      });
      expect(result.queue).toHaveLength(1);
      const entry = result.queue[0];
      expect(entry.metadata?.platform).toBe(expectedPlatform);
    });
  });

  describe('tag emission — bare convention', () => {
    it('emits bare tags — no namespace prefixes', () => {
      const result = run({
        command: 'railway up --service api',
        exitCode: 0,
        output: 'Deploy complete: https://my-app.up.railway.app',
        cwd: '/tmp/my-project',
      });
      expect(result.queue).toHaveLength(1);
      const { tags } = result.queue[0];
      expect(findNamespaceTags(tags)).toEqual([]);
      expect(tags).toContain('deployment');
      expect(tags).toContain('railway');
      expect(tags).toContain('production');
      expect(tags).toContain('my-project');
    });

    it('adds "failure" tag on non-zero exit', () => {
      const result = run({
        command: 'railway up',
        exitCode: 1,
        output: 'ERROR: build failed',
      });
      expect(result.queue[0].tags).toContain('failure');
    });

    it('uses valid AutoMem type enum', () => {
      const result = run({
        command: 'railway up',
        exitCode: 0,
        output: 'Deploy ok',
      });
      expect(VALID_TYPES).toContain(result.queue[0].type);
    });
  });

  describe('temporal validity', () => {
    it('sets t_valid on successful production deploy', () => {
      const result = run({
        command: 'railway up',
        exitCode: 0,
        output: 'Deploy complete: https://my-app.up.railway.app',
      });
      expect(result.queue[0].t_valid).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('does NOT set t_valid on failure', () => {
      const result = run({
        command: 'railway up',
        exitCode: 1,
        output: 'ERROR: deploy failed',
      });
      expect(result.queue[0].t_valid).toBeUndefined();
    });

    it('does NOT set t_valid on non-production environments', () => {
      const result = run({
        command: 'railway up --environment staging',
        exitCode: 0,
        output: 'Deploy complete to staging',
      });
      expect(result.queue[0].t_valid).toBeUndefined();
    });
  });
});
