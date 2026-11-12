import { spawnSync } from 'node:child_process';

export const DOCKER_DOWNLOAD_URL = 'https://www.docker.com/products/docker-desktop';

/** One concrete way to put Docker on this machine. Always shown before it runs. */
export type DockerInstallPlan = {
  label: string;
  command: string;
  args: string[];
};

/**
 * Pick the least surprising installer for the platform, or undefined when the
 * only honest answer is "download it yourself". Nothing here runs a command.
 */
export function planDockerInstall(
  platform: NodeJS.Platform,
  commandExists: (command: string) => boolean
): DockerInstallPlan | undefined {
  if (platform === 'darwin' && commandExists('brew')) {
    return {
      label: 'Docker Desktop via Homebrew',
      command: 'brew',
      args: ['install', '--cask', 'docker-desktop'],
    };
  }
  if (platform === 'win32' && commandExists('winget')) {
    return {
      label: 'Docker Desktop via winget',
      command: 'winget',
      args: [
        'install',
        '-e',
        '--id',
        'Docker.DockerDesktop',
        '--accept-package-agreements',
        '--accept-source-agreements',
      ],
    };
  }
  if (platform === 'linux' && commandExists('curl')) {
    // Docker's own convenience script; it asks for sudo itself.
    return {
      label: "Docker Engine via Docker's official install script (needs sudo)",
      command: 'sh',
      args: ['-c', 'curl -fsSL https://get.docker.com | sh'],
    };
  }
  return undefined;
}

export function describeDockerInstall(plan: DockerInstallPlan): string {
  return [plan.command, ...plan.args.map((arg) => (/[\s|]/.test(arg) ? `'${arg}'` : arg))].join(
    ' '
  );
}

export type DockerInstallRunner = (command: string, args: string[]) => boolean;

/** Inherit stdio so package-manager progress and sudo/UAC prompts stay visible. */
export const runDockerInstall: DockerInstallRunner = (command, args) =>
  spawnSync(command, args, { stdio: 'inherit' }).status === 0;
