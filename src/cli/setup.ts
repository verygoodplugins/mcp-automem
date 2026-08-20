import fs from 'fs';
import path from 'path';
import { stdin as input, stdout as output } from 'node:process';
import { createInterface } from 'node:readline/promises';
import {
  buildClaudeCodeExport,
  buildClaudeDesktopSnippet,
  buildHermesSnippet,
  buildMcpConfigJson,
  buildSummaryInstructions,
  DEFAULT_AUTOMEM_API_URL,
} from './templates.js';
import { applyClaudeCodeSetup } from './claude-code.js';
import {
  AUTOMEM_API_KEY_NAMES,
  mergeEnvContent,
  readApiKeyFrom,
  readEndpointFrom,
  removeEnvContentKeys,
  resolveInheritedApiKey,
  sameEndpoint,
} from './host-toolkit.js';

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

const ENV_API_URL_KEY = 'AUTOMEM_API_URL';
const LEGACY_ENV_ENDPOINT_KEY = 'AUTOMEM_ENDPOINT';
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
    let formatValue: string | undefined;
    if (arg === '--format' && args[i + 1]) {
      formatValue = args[i + 1];
      i += 1;
    } else if (arg.startsWith('--format=')) {
      formatValue = arg.slice('--format='.length);
    } else if (arg === '--json') {
      formatValue = 'json';
    }
    if (formatValue && formatValue.toLowerCase() === 'json') {
      options.format = 'json';
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

function mergeEnvFile(
  filePath: string,
  updates: Record<string, string>,
  removeKeys: readonly string[] = []
) {
  const existing = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '';
  const merged = mergeEnvContent(existing, updates);
  fs.writeFileSync(filePath, removeEnvContentKeys(merged, removeKeys), 'utf8');
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
  // `||` not `??`: an empty value (e.g. a blank AUTOMEM_API_URL= line) must
  // fall through to the next source, matching the server's own resolution.
  const defaultEndpoint =
    options.endpoint ||
    existingValues[ENV_API_URL_KEY] ||
    existingValues[LEGACY_ENV_ENDPOINT_KEY] ||
    process.env[ENV_API_URL_KEY] ||
    process.env[LEGACY_ENV_ENDPOINT_KEY] ||
    DEFAULT_AUTOMEM_API_URL;

  const endpoint =
    options.endpoint ??
    (await promptValue('AutoMem API URL', DEFAULT_AUTOMEM_API_URL, defaultEndpoint));

  // A key belongs to the endpoint it was issued for. This resolved the key from the
  // file and the environment with no endpoint check at all, and read only the
  // canonical name — so `setup --endpoint <new>` rewrote the URL and left the old
  // host's credential sitting beside it, and a legacy AUTOMEM_API_TOKEN was invisible
  // to the code that should have removed it. Computed after `endpoint` because the
  // pairing needs the endpoint actually being written.
  const storedEndpoint = readEndpointFrom(existingValues);
  const defaultApiKey =
    resolveInheritedApiKey({
      endpoint,
      explicitKey: options.apiKey,
      storedEndpoint,
      storedKey: readApiKeyFrom(existingValues),
    }) ?? '';

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
    [ENV_API_URL_KEY]: endpoint,
  };
  // Keep a pre-existing deprecated alias in sync — a stale divergent value
  // would silently resurface if AUTOMEM_API_URL were ever removed.
  const hasLegacyLine = existingValues[LEGACY_ENV_ENDPOINT_KEY] !== undefined;
  if (hasLegacyLine) {
    updates[LEGACY_ENV_ENDPOINT_KEY] = endpoint;
  }
  const writesKey = Boolean(apiKey) && apiKey !== '<required>' && apiKey !== '<unchanged>';
  if (writesKey) {
    updates[ENV_API_KEY] = apiKey;
  }

  // Nothing resolved and the file still holds a credential issued for a different
  // endpoint: remove it under both names rather than leave it to authenticate against
  // the new host. A file naming a key but no endpoint is not evidence of a mismatch,
  // so it is left alone — same rule as the guided installer's project .env.
  const persistedKeyNames = AUTOMEM_API_KEY_NAMES.filter((name) => existingValues[name]);
  const staleKeyNames =
    !writesKey &&
    persistedKeyNames.length > 0 &&
    storedEndpoint &&
    !sameEndpoint(storedEndpoint, endpoint)
      ? persistedKeyNames
      : [];

  mergeEnvFile(envPath, updates, staleKeyNames);
  console.log(`\n✅ Saved AutoMem settings to ${envPath}`);
  if (hasLegacyLine) {
    console.log(
      `ℹ️  ${LEGACY_ENV_ENDPOINT_KEY} is deprecated; it was updated to match ${ENV_API_URL_KEY}. You can remove the old line.`
    );
  }

  console.log(buildSummaryInstructions(endpoint, Boolean(apiKey)));
  console.log('Claude Desktop snippet:\n');
  console.log(buildClaudeDesktopSnippet());
  console.log('\nClaude Code setup:\n');
  console.log(buildClaudeCodeExport(endpoint, 'your-auto-mem-api-key'));
  console.log('\nHermes Agent snippet (~/.hermes/config.yaml):\n');
  // Always render the key as a placeholder — this snippet is meant to be
  // copy-pasted and shared; the real key lives in ~/.hermes/.env / config.yaml.
  console.log(buildHermesSnippet(endpoint, '${AUTOMEM_API_KEY}'));
  console.log('\nOr run: npx @verygoodplugins/mcp-automem hermes');
  console.log(
    '\nUse `npx @verygoodplugins/mcp-automem config --format=json` to print this snippet again later.'
  );

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
  const endpoint =
    process.env[ENV_API_URL_KEY] || process.env[LEGACY_ENV_ENDPOINT_KEY] || DEFAULT_AUTOMEM_API_URL;
  const apiKey = process.env[ENV_API_KEY] ?? '${AUTOMEM_API_KEY}';

  if (options.format === 'json') {
    console.log(JSON.stringify(buildMcpConfigJson(endpoint, apiKey), null, 2));
    return;
  }

  console.log('Claude Desktop snippet:\n');
  console.log(buildClaudeDesktopSnippet());
  console.log('\nClaude Code setup:\n');
  console.log(buildClaudeCodeExport(endpoint, 'your-auto-mem-api-key'));
  console.log('\nHermes Agent snippet (~/.hermes/config.yaml):\n');
  // Placeholder key only — the JSON dump above (config --format=json) is the
  // single surface that intentionally echoes the resolved key.
  console.log(buildHermesSnippet(endpoint, '${AUTOMEM_API_KEY}'));
}
