import type { AgentClient } from '../../src/cli/clients.js';

export interface HostSmokeSpec {
  /**
   * The MCP *registration surface*, not the installer client. One client can expose
   * several (Copilot registers separately for its CLI and for VS Code), and the surface
   * is what determines the tool-name mangling below.
   */
  host:
    | 'hermes'
    | 'codex'
    | 'claude-code'
    | 'cursor'
    | 'copilot-cli'
    | 'vscode-copilot'
    | 'grok'
    | 'openclaw';
  /**
   * The installer client this surface belongs to, or 'copilot' for the standalone
   * platform. tests/docs/host-parity.test.ts uses this to prove every client has
   * smoke coverage.
   */
  client: AgentClient | 'copilot';
  configPath: string;
  installCommand: string[];
  expectedToolNames: string[];
  validationCommand?: string[];
  realHostSmoke: 'required-when-installed' | 'config-and-mcp-contract';
}

const RAW_AUTOMEM_TOOLS = [
  'store_memory',
  'recall_memory',
  'associate_memories',
  'update_memory',
  'delete_memory',
  'check_database_health',
];
const HERMES_AUTOMEM_TOOLS = RAW_AUTOMEM_TOOLS.filter((name) => name !== 'delete_memory');
/**
 * OpenClaw registers its tools in-process from src/openclaw-plugin.ts rather than over
 * stdio MCP, and shortens one of them: `check_database_health` is exposed as
 * `automem_check_health`. That rename is exactly the kind of per-host quirk these specs
 * exist to pin down.
 */
const OPENCLAW_AUTOMEM_TOOLS = RAW_AUTOMEM_TOOLS.map((name) =>
  name === 'check_database_health' ? 'automem_check_health' : `automem_${name}`
);

export const HOST_SMOKE_SPECS: HostSmokeSpec[] = [
  {
    host: 'hermes',
    client: 'hermes',
    configPath: '$HERMES_HOME/config.yaml',
    installCommand: ['mcp-automem', 'hermes', '--mode', 'mcp'],
    expectedToolNames: HERMES_AUTOMEM_TOOLS.map((name) => `mcp_automem_${name}`).sort(),
    validationCommand: ['hermes', 'mcp', 'test', 'automem'],
    realHostSmoke: 'required-when-installed',
  },
  {
    host: 'codex',
    client: 'codex',
    configPath: '~/.codex/config.toml',
    installCommand: ['mcp-automem', 'codex'],
    expectedToolNames: RAW_AUTOMEM_TOOLS.map((name) => `mcp__memory__${name}`).sort(),
    realHostSmoke: 'config-and-mcp-contract',
  },
  {
    host: 'cursor',
    client: 'cursor',
    configPath: '~/.cursor/mcp.json',
    installCommand: ['mcp-automem', 'cursor'],
    expectedToolNames: RAW_AUTOMEM_TOOLS.map((name) => `mcp_memory_${name}`).sort(),
    realHostSmoke: 'config-and-mcp-contract',
  },
  {
    host: 'claude-code',
    client: 'claude-code',
    configPath: '~/.claude.json',
    installCommand: ['mcp-automem', 'claude-code'],
    expectedToolNames: RAW_AUTOMEM_TOOLS.map((name) => `mcp__memory__${name}`).sort(),
    validationCommand: ['claude', 'mcp', 'list'],
    realHostSmoke: 'config-and-mcp-contract',
  },
  {
    host: 'copilot-cli',
    client: 'copilot',
    configPath: '$COPILOT_HOME/mcp-config.json',
    installCommand: ['mcp-automem', 'copilot', '--format', 'cli'],
    expectedToolNames: RAW_AUTOMEM_TOOLS.map((name) => `automem-${name}`).sort(),
    realHostSmoke: 'config-and-mcp-contract',
  },
  {
    host: 'vscode-copilot',
    client: 'copilot',
    configPath: '.vscode/mcp.json',
    installCommand: ['mcp-automem', 'copilot', '--format', 'vscode'],
    expectedToolNames: RAW_AUTOMEM_TOOLS.map((name) => `mcp_automem_${name}`).sort(),
    realHostSmoke: 'config-and-mcp-contract',
  },
  {
    host: 'grok',
    client: 'grok',
    configPath: '~/.grok/config.toml',
    installCommand: ['mcp-automem', 'grok'],
    expectedToolNames: RAW_AUTOMEM_TOOLS.map((name) => `memory__${name}`).sort(),
    realHostSmoke: 'config-and-mcp-contract',
  },
  {
    host: 'openclaw',
    client: 'openclaw',
    configPath: '~/.openclaw/openclaw.json',
    installCommand: ['mcp-automem', 'openclaw'],
    expectedToolNames: [...OPENCLAW_AUTOMEM_TOOLS].sort(),
    realHostSmoke: 'config-and-mcp-contract',
  },
];
