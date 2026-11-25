#!/usr/bin/env node
// A stateful stand-in for the `claude` CLI, for the installer e2e suites. It
// answers only the `claude plugin …` calls the installer makes and prints the
// output shapes and exit codes Claude Code 2.1.329/2.1.330 were seen to print.
//
// Environment:
//   FAKE_CLAUDE_MODE   happy (default) | old-cli | unmapped | update-fixes
//   FAKE_CLAUDE_LOG    call log (default $HOME/.e2e-claude-calls.log); one line
//                      per call, `claude <argv>`. Argv only, never stdin.
//   FAKE_CLAUDE_STATE  JSON state file (default $HOME/.e2e-claude-state.json).
//                      A saved key is recorded only as a fingerprint (key-fingerprint.mjs).
//   FAKE_CLAUDE_SEED   earlier-install: when there is no state file yet, start as
//                      if an earlier install had added the marketplace, installed
//                      the plugin (env mapping per mode) and saved an API key.
//
// Failure branches print fixed text: nothing read from stdin or argv is echoed.
//
// Modes:
//   happy         the installed plugin's memory server has the env mapping.
//   old-cli       `configure --values-stdin` is an unknown option (exit 1); stdin
//                 is never read, as an older Claude Code would behave.
//   unmapped      the installed plugin has no env mapping, and `plugin update`
//                 reports it is already at the latest version.
//   update-fixes  no env mapping until `plugin update` installs a newer version.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { keyFingerprint } from './key-fingerprint.mjs';

const REF = 'automem@verygoodplugins-mcp-automem';
const MARKETPLACE = 'verygoodplugins-mcp-automem';
const OPTIONS = ['api_url', 'api_key'];
const HOME = process.env.HOME || os.homedir();
const MODE = process.env.FAKE_CLAUDE_MODE || 'happy';
const LOG = process.env.FAKE_CLAUDE_LOG || path.join(HOME, '.e2e-claude-calls.log');
const STATE = process.env.FAKE_CLAUDE_STATE || path.join(HOME, '.e2e-claude-state.json');
// Written as Claude Code prints them: placeholders, never values.
const ENV_MAPPING = {
  CLAUDE_PLUGIN_OPTION_API_URL: '${user_config.api_url}',
  CLAUDE_PLUGIN_OPTION_API_KEY: '${user_config.api_key}',
};

const argv = process.argv.slice(2);
if (argv[0] === '--version') {
  process.stdout.write('2.1.329 (Claude Code)\n');
  process.exit(0);
}
fs.appendFileSync(LOG, `claude ${argv.join(' ')}\n`);

const hasEnvMapping = () => MODE === 'happy' || MODE === 'old-cli';

function load() {
  try {
    return JSON.parse(fs.readFileSync(STATE, 'utf8'));
  } catch {
    if (process.env.FAKE_CLAUDE_SEED === 'earlier-install') {
      return {
        marketplace: true,
        plugin: {
          version: '0.19.3',
          env: hasEnvMapping(),
          installedAt: '2026-11-01T00:00:00.000Z',
        },
        values: {
          api_url: 'http://127.0.0.1:8001',
          api_key_fingerprint: keyFingerprint('earlier-install-key'),
        },
        saves: [],
      };
    }
    return { marketplace: false, plugin: null, values: {}, saves: [] };
  }
}
function save(state) {
  fs.writeFileSync(STATE, `${JSON.stringify(state, null, 2)}\n`);
}
function out(text, code = 0) {
  if (text) process.stdout.write(text);
  process.exit(code);
}
function fail(text, code = 1) {
  process.stderr.write(text);
  process.exit(code);
}
const state = load();
const [group, sub, ...rest] = argv;
if (group !== 'plugin') fail('error: unknown command\n');

if (sub === 'marketplace' && rest[0] === 'list') {
  if (!state.marketplace) out('No marketplaces configured\n');
  out(
    `Configured marketplaces:\n\n  ❯ ${MARKETPLACE}\n    Source: GitHub (verygoodplugins/mcp-automem)\n`
  );
}

if (sub === 'marketplace' && rest[0] === 'update') {
  if (rest[1] !== MARKETPLACE || !state.marketplace) fail('Marketplace not found\n');
  out(`✔ Successfully updated marketplace: ${MARKETPLACE}\n`);
}

if (sub === 'marketplace' && rest[0] === 'add') {
  state.marketplace = true;
  save(state);
  out(`Successfully added marketplace: ${MARKETPLACE}\n`);
}

if (sub === 'install') {
  if (rest[0] !== REF || !state.marketplace) fail('Plugin not found\n');
  const config = rest.indexOf('--config');
  const apiUrl = config >= 0 ? (rest[config + 1] ?? '').replace(/^api_url=/, '') : '';
  const already = Boolean(state.plugin);
  if (!already) {
    state.plugin = {
      version: '0.19.3',
      env: hasEnvMapping(),
      installedAt: new Date().toISOString(),
    };
  }
  if (apiUrl) state.values.api_url = apiUrl;
  save(state);
  out(
    already
      ? `Plugin ${REF} is already installed (scope: user). Configuration updated.\n`
      : `Successfully installed plugin: ${REF} (scope: user)\n`
  );
}

if (sub === 'configure' && rest.includes('--values-stdin')) {
  // An older Claude Code rejects the flag before reading anything.
  if (MODE === 'old-cli') fail("error: unknown option '--values-stdin'\n");
  if (rest[0] !== REF || !state.plugin) fail('Plugin is not installed\n');
  let input;
  try {
    input = JSON.parse(fs.readFileSync(0, 'utf8'));
  } catch {
    fail('Expected a JSON object of option values on stdin\n');
  }
  if (!input || typeof input !== 'object' || Array.isArray(input))
    fail('Expected a JSON object of option values on stdin\n');
  let changed = false;
  for (const [name, value] of Object.entries(input)) {
    if (!OPTIONS.includes(name)) fail('Unknown option name\n');
    if (typeof value !== 'string') fail('Option values must be strings\n');
    if (/[\r\n]/.test(value)) fail('Option values must be a single line.\n');
    // An empty or whitespace-only value never clears a saved one.
    if (!value.trim()) continue;
    if (name === 'api_key') {
      const hash = keyFingerprint(value);
      if (state.values.api_key_fingerprint !== hash) {
        state.values.api_key_fingerprint = hash;
        changed = true;
      }
    } else if (state.values[name] !== value) {
      state.values[name] = value;
      changed = true;
    }
  }
  if (!changed) out('No configuration changes.\n');
  state.saves.push({
    options: Object.keys(input),
    ...(input.api_key ? { api_key_fingerprint: keyFingerprint(input.api_key) } : {}),
  });
  save(state);
  out('Configuration saved. Restart Claude Code to apply it.\n');
}

if (sub === 'configure' && rest.includes('--json')) {
  if (rest[0] !== REF || !state.plugin) fail('Plugin is not installed\n');
  const configured = [];
  if (state.values.api_url) configured.push('api_url');
  if (state.values.api_key_fingerprint) configured.push('api_key');
  out(
    `${JSON.stringify({
      pluginId: REF,
      displayName: 'AutoMem',
      schema: {
        api_url: { type: 'string', title: 'AutoMem API URL', sensitive: false },
        api_key: { type: 'string', title: 'AutoMem API key', sensitive: true },
      },
      inputs: { api_url: state.values.api_url ?? '', api_key: '' },
      choices: {},
      configured,
      unconfigured: OPTIONS.filter((name) => !configured.includes(name)),
    })}\n`
  );
}

if (sub === 'list' && rest.includes('--json')) {
  if (!state.plugin) out('[]\n');
  const version = state.plugin.version;
  out(
    `${JSON.stringify([
      {
        id: REF,
        version,
        scope: 'user',
        enabled: true,
        installPath: path.join(HOME, '.claude/plugins/cache', MARKETPLACE, 'automem', version),
        installedAt: state.plugin.installedAt,
        lastUpdated: state.plugin.installedAt,
        mcpServers: {
          memory: {
            command: 'npx',
            args: ['-y', '@verygoodplugins/mcp-automem@latest'],
            ...(state.plugin.env ? { env: ENV_MAPPING } : {}),
          },
        },
        projectEnabled: false,
        hasUserConfig: true,
      },
    ])}\n`
  );
}

if (sub === 'update') {
  if (rest[0] !== REF || !state.plugin) fail('Plugin is not installed\n');
  if (MODE === 'update-fixes' && !state.plugin.env) {
    state.plugin = { ...state.plugin, version: '0.20.0', env: true };
    save(state);
    out(
      'Plugin "automem" updated from 0.19.3 to 0.20.0 for scope user. Restart to apply changes.\n'
    );
  }
  out(`automem is already at the latest version (${state.plugin.version}).\n`);
}

fail('error: unknown command\n');
