/**
 * The set of agent clients the guided installer can configure, plus the drift-control
 * lists that describe where a client is deliberately *not* supported.
 *
 * This lives apart from install.ts so uninstall.ts, src/index.ts, and the parity tests
 * can name clients without importing the installer (and, transitively, every host
 * module and the cloud-provisioning stack).
 */

export const AGENT_CLIENTS = [
  'codex',
  'claude-code',
  'cursor',
  'openclaw',
  'hermes',
  'grok',
] as const;

export type AgentClient = (typeof AGENT_CLIENTS)[number];

/** Pre-selected when the installer runs without an explicit --clients list. */
export const DEFAULT_AGENT_CLIENTS = [
  'codex',
  'claude-code',
  'cursor',
  'openclaw',
] as const satisfies readonly AgentClient[];

/**
 * Installable but not yet uninstallable. Every entry here is a gap, not a design
 * choice — tests/docs/host-parity.test.ts fails if a client is missing from the
 * uninstall surface without being listed.
 */
export const UNINSTALL_UNSUPPORTED_CLIENTS = ['openclaw'] as const satisfies readonly AgentClient[];

/**
 * Hosts with their own `mcp-automem <name>` setup and uninstall commands that the
 * guided installer does not offer in its agent list. Copilot is configured per-surface
 * (CLI vs VS Code) rather than as a single checkbox, so it is not an AgentClient.
 */
export const STANDALONE_PLATFORMS = ['copilot'] as const;

export type UninstallPlatform =
  | Exclude<AgentClient, (typeof UNINSTALL_UNSUPPORTED_CLIENTS)[number]>
  | (typeof STANDALONE_PLATFORMS)[number];

export const UNINSTALL_PLATFORMS = [
  ...AGENT_CLIENTS.filter(
    (client): client is Exclude<AgentClient, (typeof UNINSTALL_UNSUPPORTED_CLIENTS)[number]> =>
      !(UNINSTALL_UNSUPPORTED_CLIENTS as readonly string[]).includes(client)
  ),
  ...STANDALONE_PLATFORMS,
] as const satisfies readonly UninstallPlatform[];

/**
 * Every per-host setup subcommand the CLI routes. Derived so a new client cannot be
 * routed without also being recognized (an unlisted command falls through to stdio
 * server mode and skips dotenv-banner silencing).
 */
export const HOST_SETUP_COMMANDS = [...AGENT_CLIENTS, ...STANDALONE_PLATFORMS] as const;
