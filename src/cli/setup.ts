import fs from 'fs';
import os from 'os';
import path from 'path';
import { stdin as input, stdout as output } from 'node:process';
import { createInterface } from 'node:readline/promises';
import { buildClaudeCodeExport, buildClaudeDesktopSnippet, buildSummaryInstructions, DEFAULT_AUTOMEM_ENDPOINT } from './templates.js';
import { applyClaudeCodeSetup } from './claude-code.js';

interface SetupOptions {
  envPath?: string;
  endpoint?: string;
  apiKey?: string;
  yes?: boolean;
  claudeCode?: boolean;
  claudeDir?: string;
  claudeDryRun?: boolean;
}

interface ConfigOptions {
  format: 'text' | 'json';
}

const ENV_ENDPOINT_KEY = 'AUTOMEM_ENDPOINT';
const ENV_API_KEY = 'AUTOMEM_API_KEY';

function parseSetupArgs(args: string[]): SetupOptions {
  const options: SetupOptions = {};
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    switch (arg) {
      case '--env':
      case '-e':
        options.envPath = args[i + 1];
        i += 1;
        break;
      case '--endpoint':
        options.endpoint = args[i + 1];
        i += 1;
        break;
      case '--api-key':
        options.apiKey = args[i + 1];
        i += 1;
        break;
      case '--claude-code':
        options.claudeCode = true;
        break;
      case '--claude-dir':
        options.claudeDir = args[i + 1];
        i += 1;
        break;
      case '--claude-dry-run':
        options.claudeDryRun = true;
        break;
      case '--yes':
      case '-y':
        options.yes = true;
        break;
      default:
        break;
    }
  }
  return options;
}

function parseConfigArgs(args: string[]): ConfigOptions {
  const options: ConfigOptions = { format: 'text' };
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--format' && args[i + 1]) {
      const formatValue = args[i + 1].toLowerCase();
      if (formatValue === 'json') {
        options.format = 'json';
      }
      i += 1;
    }
  }
  return options;
}

function loadEnvValues(filePath: string): Record<string, string> {
  if (!fs.existsSync(filePath)) {
    return {};
  }
  const result: Record<string, string> = {};
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const match = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)\s*$/);
    if (match) {
      const key = match[1].trim();
      let value = match[2].trim();
      if (value.startsWith('"') && value.endsWith('"')) {
        value = value.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
      }
      result[key] = value;
    }
  }
  return result;
}

function formatEnvValue(value: string): string {
  const needsQuotes = /[^A-Za-z0-9_@\/:.,+-]/.test(value);
  if (!needsQuotes) {
    return value;
  }
  const escaped = value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return `"${escaped}"`;
}

function mergeEnvFile(filePath: string, updates: Record<string, string>) {
  const lines: Array<{ key?: string; line: string }> = [];
  if (fs.existsSync(filePath)) {
    const existing = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
    for (const line of existing) {
      if (!line.trim()) {
        lines.push({ line });
        continue;
      }
      const match = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$/);
      if (match) {
        lines.push({ key: match[1].trim(), line });
      } else {
        lines.push({ line });
      }
    }
  }

  const updatedKeys = new Set<string>();
  for (const entry of lines) {
    if (entry.key && Object.prototype.hasOwnProperty.call(updates, entry.key)) {
      entry.line = `${entry.key}=${formatEnvValue(updates[entry.key] ?? '')}`;
      updatedKeys.add(entry.key);
    }
  }

  for (const [key, value] of Object.entries(updates)) {
    if (!updatedKeys.has(key)) {
      lines.push({ key, line: `${key}=${formatEnvValue(value)}` });
    }
  }

  const content = lines.map((entry) => entry.line).join(os.EOL).replace(/\s+$/, '');
  const finalContent = content.length ? `${content}${os.EOL}` : '';
  fs.writeFileSync(filePath, finalContent, 'utf8');
}

async function promptValue(prompt: string, fallback: string, prefilled?: string): Promise<string> {
  if (!input.isTTY || !output.isTTY) {
    return prefilled ?? fallback;
  }
  const rl = createInterface({ input, output });
  try {
    const answer = await rl.question(`${prompt} [${prefilled ?? fallback}]: `);
    const trimmed = answer.trim();
    return trimmed || prefilled || fallback;
  } finally {
    rl.close();
  }
}

export async function runSetup(args: string[] = []): Promise<void> {
  const options = parseSetupArgs(args);
  const envPath = path.resolve(options.envPath ?? '.env');

  const existingValues = loadEnvValues(envPath);
  const defaultEndpoint = options.endpoint
    ?? existingValues[ENV_ENDPOINT_KEY]
    ?? process.env[ENV_ENDPOINT_KEY]
    ?? DEFAULT_AUTOMEM_ENDPOINT;

  const defaultApiKey = options.apiKey
    ?? existingValues[ENV_API_KEY]
    ?? process.env[ENV_API_KEY]
    ?? '';

  const endpoint = options.endpoint
    ?? await promptValue('AutoMem endpoint', DEFAULT_AUTOMEM_ENDPOINT, defaultEndpoint);

  let apiKey = options.apiKey ?? defaultApiKey;
  if (!options.apiKey && input.isTTY && output.isTTY) {
    const rl = createInterface({ input, output });
    try {
      const promptSuffix = defaultApiKey ? ' (leave blank to keep existing)' : '';
      const answer = await rl.question(`AutoMem API key${promptSuffix}: `);
      const trimmed = answer.trim();
      if (trimmed) {
        apiKey = trimmed;
      }
    } finally {
      rl.close();
    }
  }

  if (!options.yes && input.isTTY && output.isTTY) {
    const rl = createInterface({ input, output });
    try {
      const confirmation = await rl.question(`\nWrite settings to ${envPath}? [Y/n]: `);
      const normalized = confirmation.trim().toLowerCase();
      if (normalized === 'n' || normalized === 'no') {
        console.log('Aborted setup. No files were changed.');
        return;
      }
    } finally {
      rl.close();
    }
  }

  const updates: Record<string, string> = {
    [ENV_ENDPOINT_KEY]: endpoint,
  };
  if (apiKey && apiKey !== '<required>' && apiKey !== '<unchanged>') {
    updates[ENV_API_KEY] = apiKey;
  }

  mergeEnvFile(envPath, updates);
  console.log(`\n✅ Saved AutoMem settings to ${envPath}`);

  console.log(buildSummaryInstructions(endpoint, Boolean(apiKey)));
  console.log('Claude Desktop snippet:\n');
  console.log(buildClaudeDesktopSnippet());
  console.log('\nClaude Code setup:\n');
  console.log(buildClaudeCodeExport(endpoint, 'your-auto-mem-api-key'));
  console.log('\nUse `npx @verygoodplugins/mcp-automem config --format=json` to print this snippet again later.');

  if (options.claudeCode) {
    await applyClaudeCodeSetup({
      targetDir: options.claudeDir,
      dryRun: options.claudeDryRun,
      yes: options.yes,
    });
  }
}

export async function runConfig(args: string[] = []): Promise<void> {
  const options = parseConfigArgs(args);
  const endpoint = process.env[ENV_ENDPOINT_KEY] ?? DEFAULT_AUTOMEM_ENDPOINT;
  const apiKey = process.env[ENV_API_KEY] ?? '${AUTOMEM_API_KEY}';

  if (options.format === 'json') {
    const snippet = {
      mcpServers: {
        automem: {
          command: 'npx',
          args: ['@verygoodplugins/mcp-automem'],
          env: {
            AUTOMEM_ENDPOINT: endpoint,
            AUTOMEM_API_KEY: apiKey,
          },
        },
      },
    };
    console.log(JSON.stringify(snippet, null, 2));
    return;
  }

  console.log('Claude Desktop snippet:\n');
  console.log(buildClaudeDesktopSnippet());
  console.log('\nClaude Code setup:\n');
  console.log(buildClaudeCodeExport(endpoint, 'your-auto-mem-api-key'));
}
