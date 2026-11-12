import { describe, expect, it } from 'vitest';
import { describeDockerInstall, planDockerInstall } from './docker-install.js';

const has =
  (...commands: string[]) =>
  (command: string) =>
    commands.includes(command);

describe('planDockerInstall', () => {
  it('uses Homebrew on macOS and the current cask name', () => {
    expect(planDockerInstall('darwin', has('brew'))).toMatchObject({
      command: 'brew',
      args: ['install', '--cask', 'docker-desktop'],
    });
  });

  it('uses winget on Windows and the official script on Linux', () => {
    expect(planDockerInstall('win32', has('winget'))?.args).toContain('Docker.DockerDesktop');
    expect(describeDockerInstall(planDockerInstall('linux', has('curl'))!)).toBe(
      "sh -c 'curl -fsSL https://get.docker.com | sh'"
    );
  });

  it('returns nothing when there is no safe automatic route', () => {
    expect(planDockerInstall('darwin', has())).toBeUndefined();
    expect(planDockerInstall('win32', has())).toBeUndefined();
    expect(planDockerInstall('linux', has())).toBeUndefined();
    expect(planDockerInstall('freebsd', has('brew', 'curl'))).toBeUndefined();
  });
});
