import os from 'os';

export const DEFAULT_AUTOMEM_ENDPOINT = 'http://127.0.0.1:8001';

export function buildClaudeDesktopSnippet(endpointVar = '${AUTOMEM_ENDPOINT}', apiKeyVar = '${AUTOMEM_API_KEY}') {
  return `{
  "mcpServers": {
    "automem": {
      "command": "npx",
      "args": ["@verygoodplugins/mcp-automem"],
      "env": {
        "AUTOMEM_ENDPOINT": "${endpointVar}",
        "AUTOMEM_API_KEY": "${apiKeyVar}"
      }
    }
  }
}`;
}

export function buildClaudeCodeExport(endpoint = DEFAULT_AUTOMEM_ENDPOINT, apiKey = 'your-auto-mem-api-key') {
  return [
    'claude mcp add automem "npx @verygoodplugins/mcp-automem"',
    `export AUTOMEM_ENDPOINT="${endpoint}"`,
    `export AUTOMEM_API_KEY="${apiKey}"`
  ].join(os.EOL);
}

export function buildSummaryInstructions(endpoint: string, apiKeyProvided: boolean) {
  const lines: string[] = [
    '',
    'Next steps:',
    '  • Add the Claude Desktop snippet below to claude_desktop_config.json (macOS: ~/Library/Application Support/Claude/claude_desktop_config.json)',
    '  • Or run the Claude Code command shown to register the server in Claude Code',
    apiKeyProvided ? '  • Environment variables updated in your .env file' : '  • Remember to set AUTOMEM_API_KEY before connecting (no key provided during setup)',
    `  • Endpoint configured to ${endpoint}`,
    ''
  ];

  return lines.join('\n');
}
