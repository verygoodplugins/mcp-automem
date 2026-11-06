import os from 'os';

export const DEFAULT_AUTOMEM_API_URL = 'http://127.0.0.1:8001';

/**
 * The npx spec every launch command we write or print uses. It has to name a dist-tag:
 * npm treats any spec the current folder's package already satisfies (unpinned, a
 * range, or the exact version) as the local project and runs its bin from PATH. Inside
 * a clone of this repo that fails with `sh: mcp-automem: not found`, or silently runs
 * a global install instead. A dist-tag is never satisfied locally. Pinning the release
 * version is not an alternative: it collides on every release-tagged clone.
 */
export const AUTOMEM_NPX_PACKAGE = '@verygoodplugins/mcp-automem@latest';

/**
 * The `npx` prefix for every CLI subcommand we print (`install`, `uninstall`, help, …).
 * It needs the dist-tag for the same reason as launch commands, and because with a
 * global install the unpinned spec silently runs that, possibly older, build.
 */
export const AUTOMEM_NPX_COMMAND = `npx ${AUTOMEM_NPX_PACKAGE}`;

/** Fresh `npx` args for an AutoMem server entry; a new array so callers never share one. */
export function automemNpxArgs(): string[] {
  return ['-y', AUTOMEM_NPX_PACKAGE];
}

export function buildClaudeDesktopSnippet(
  endpointVar = '${AUTOMEM_API_URL}',
  apiKeyVar = '${AUTOMEM_API_KEY}'
) {
  return `{
  "mcpServers": {
    "memory": {
      "command": "npx",
      "args": ["-y", "${AUTOMEM_NPX_PACKAGE}"],
      "env": {
        "AUTOMEM_API_URL": "${endpointVar}",
        "AUTOMEM_API_KEY": "${apiKeyVar}"
      }
    }
  }
}`;
}

export function buildClaudeCodeExport(
  endpoint = DEFAULT_AUTOMEM_API_URL,
  apiKey = 'your-auto-mem-api-key'
) {
  return [
    `claude mcp add memory "npx -y ${AUTOMEM_NPX_PACKAGE}"`,
    `export AUTOMEM_API_URL="${endpoint}"`,
    `export AUTOMEM_API_KEY="${apiKey}"`,
  ].join(os.EOL);
}

export function buildHermesSnippet(endpoint = '${AUTOMEM_API_URL}', apiKey = '${AUTOMEM_API_KEY}') {
  // YAML form for ~/.hermes/config.yaml under the `mcp_servers` key.
  return `mcp_servers:
  automem:
    command: npx
    args:
      - -y
      - "${AUTOMEM_NPX_PACKAGE}"
    env:
      AUTOMEM_API_URL: "${endpoint}"
      AUTOMEM_API_KEY: "${apiKey}"
    tools:
      include:
        - recall_memory
        - store_memory
        - associate_memories
        - update_memory
        - check_database_health
      resources: false
      prompts: false
    sampling:
      enabled: false`;
}

export function buildMcpConfigJson(endpoint: string, apiKey: string) {
  return {
    mcpServers: {
      memory: {
        command: 'npx',
        args: automemNpxArgs(),
        env: {
          AUTOMEM_API_URL: endpoint,
          AUTOMEM_API_KEY: apiKey,
        },
      },
    },
  };
}

export function buildSummaryInstructions(endpoint: string, apiKeyProvided: boolean) {
  const lines: string[] = [
    '',
    'Next steps:',
    '  • Add the Claude Desktop snippet below to claude_desktop_config.json (macOS: ~/Library/Application Support/Claude/claude_desktop_config.json)',
    '  • Or run the Claude Code command shown to register the server in Claude Code',
    apiKeyProvided
      ? '  • Environment variables updated in your .env file'
      : '  • Remember to set AUTOMEM_API_KEY before connecting (no key provided during setup)',
    `  • Endpoint configured to ${endpoint}`,
    '',
  ];

  return lines.join('\n');
}
