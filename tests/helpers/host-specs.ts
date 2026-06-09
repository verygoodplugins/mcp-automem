export interface HostSmokeSpec {
  host: 'hermes' | 'codex' | 'claude-code' | 'cursor';
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
];
