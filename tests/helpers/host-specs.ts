export interface HostSmokeSpec {
  host: 'hermes' | 'codex' | 'claude-code' | 'cursor' | 'copilot-cli' | 'vscode-copilot' | 'grok';
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

export const HOST_SMOKE_SPECS: HostSmokeSpec[] = [
  {
    host: 'hermes',
    configPath: '$HERMES_HOME/config.yaml',
    installCommand: ['mcp-automem', 'hermes', '--mode', 'mcp'],
    expectedToolNames: HERMES_AUTOMEM_TOOLS.map((name) => `mcp_automem_${name}`).sort(),
    validationCommand: ['hermes', 'mcp', 'test', 'automem'],
    realHostSmoke: 'required-when-installed',
  },
  {
    host: 'codex',
    configPath: '~/.codex/config.toml',
    installCommand: ['mcp-automem', 'codex'],
    expectedToolNames: RAW_AUTOMEM_TOOLS.map((name) => `mcp__memory__${name}`).sort(),
    realHostSmoke: 'config-and-mcp-contract',
  },
  {
    host: 'cursor',
    configPath: '~/.cursor/mcp.json',
    installCommand: ['mcp-automem', 'cursor'],
    expectedToolNames: RAW_AUTOMEM_TOOLS.map((name) => `mcp_memory_${name}`).sort(),
    realHostSmoke: 'config-and-mcp-contract',
  },
  {
    host: 'claude-code',
    configPath: '~/.claude.json',
    installCommand: ['mcp-automem', 'claude-code'],
    expectedToolNames: RAW_AUTOMEM_TOOLS.map((name) => `mcp__memory__${name}`).sort(),
    validationCommand: ['claude', 'mcp', 'list'],
    realHostSmoke: 'config-and-mcp-contract',
  },
  {
    host: 'copilot-cli',
    configPath: '$COPILOT_HOME/mcp-config.json',
    installCommand: ['mcp-automem', 'copilot', '--format', 'cli'],
    expectedToolNames: RAW_AUTOMEM_TOOLS.map((name) => `automem-${name}`).sort(),
    realHostSmoke: 'config-and-mcp-contract',
  },
  {
    host: 'vscode-copilot',
    configPath: '.vscode/mcp.json',
    installCommand: ['mcp-automem', 'copilot', '--format', 'vscode'],
    expectedToolNames: RAW_AUTOMEM_TOOLS.map((name) => `mcp_automem_${name}`).sort(),
    realHostSmoke: 'config-and-mcp-contract',
  },
  {
    host: 'grok',
    configPath: '~/.grok/config.toml',
    installCommand: ['mcp-automem', 'grok'],
    expectedToolNames: RAW_AUTOMEM_TOOLS.map((name) => `memory__${name}`).sort(),
    realHostSmoke: 'config-and-mcp-contract',
  },
];
