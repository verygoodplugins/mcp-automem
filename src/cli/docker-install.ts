import { spawnSync } from 'node:child_process';

export const DOCKER_DOWNLOAD_URL = 'https://www.docker.com/products/docker-desktop';
export const DOCKER_LINUX_POSTINSTALL_URL =
  'https://docs.docker.com/engine/install/linux-postinstall/';

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

/**
 * Docker is up but this user may not talk to it. On Linux the install script leaves
 * a root-only socket, and a group change only applies to a new login session.
 */
export function dockerPermissionHint(platform: NodeJS.Platform): string {
  if (platform === 'linux') {
    return [
      'Add your user to the docker group, sign out and back in (or run `newgrp docker`), then re-run the installer:',
      '  sudo usermod -aG docker "$USER"',
      `Rootless mode and details: ${DOCKER_LINUX_POSTINSTALL_URL}`,
    ].join('\n');
  }
  return `Make sure your user is allowed to use Docker (${DOCKER_DOWNLOAD_URL}), then re-run the installer.`;
}
