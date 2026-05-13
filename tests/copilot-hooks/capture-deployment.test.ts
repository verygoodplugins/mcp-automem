/**
 * Execution tests for templates/copilot/scripts/capture-deployment.{sh,ps1}
 *
 * Both bash and pwsh variants are tested. Each describe block is skipped when
 * the required interpreter is not available.
 */

import { afterEach, describe, expect, it } from 'vitest';
import {
  cleanup, findNamespaceTags, hasBash, hasPwsh,
  runCaptureHook, VALID_TYPES, type Shell,
} from './helpers';

function deployCaptureSuite(shell: Shell) {
  const homes: string[] = [];
  afterEach(() => { while (homes.length) cleanup(homes.pop()!); });

  function run(input: Parameters<typeof runCaptureHook>[2]) {
    const result = runCaptureHook(shell, 'capture-deployment', input);
    homes.push(result.home);
    return result;
  }

  describe('matcher -- must NOT fire for read-only commands', () => {
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

  describe('matcher -- MUST fire for real deploy actions', () => {
    it.each([
      ['railway up', 'railway up --service api'],
      ['vercel deploy --prod', 'vercel deploy --prod'],
      ['netlify deploy', 'netlify deploy --prod'],
      ['kubectl apply', 'kubectl apply -f deployment.yaml'],
      ['az deployment create', 'az deployment group create --resource-group myRg --template-file main.bicep'],
      ['dotnet publish', 'dotnet publish -c Release'],
    ])('captures: %s', (_label, command) => {
      const result = run({
        command,
        exitCode: 0,
        output: 'Deploy complete: https://example.com (v1.2.3)',
      });
      expect(result.queue).toHaveLength(1);
    });
  });

  describe('tag emission -- bare convention', () => {
    it('emits bare tags -- no namespace prefixes', () => {
      const result = run({
        command: 'railway up --service api',
        exitCode: 0,
        output: 'Deploy complete: https://my-app.up.railway.app',
        cwd: '/tmp/my-project',
      });
      expect(result.queue).toHaveLength(1);
      const { tags } = result.queue[0];
      expect(findNamespaceTags(tags)).toEqual([]);
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
}

describe.skipIf(!hasBash())('capture-deployment.sh (bash)', () => {
  deployCaptureSuite('bash');
});

describe.skipIf(!hasPwsh())('capture-deployment.ps1 (pwsh)', () => {
  deployCaptureSuite('pwsh');
});
