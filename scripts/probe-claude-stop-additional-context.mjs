#!/usr/bin/env node
import { execFileSync, spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const CURRENT_IMPERATIVE_TEXT =
  'AUTOMEM_CURRENT_IMPERATIVE_MARKER No memories were stored this session. If a durable preference, correction, decision, pattern, or insight emerged, store it now via the store_memory tool. Do NOT store session summaries; reply with exactly: Nothing durable to store.';

const NEUTRAL_FACTUAL_TEXT =
  'AUTOMEM_NEUTRAL_FACTUAL_MARKER AutoMem status: no memory has been stored this session. Durable candidates: corrections, stabilized decisions, articulated patterns, and root-cause insights. Non-candidates: session summaries, progress notes, confirmations, and temporary output.';

const PLAIN_STDOUT_TEXT =
  'AUTOMEM_PLAIN_STDOUT_MARKER plain stdout from a Stop hook negative control.';

const VARIANTS = [
  {
    name: 'current-imperative',
    marker: 'AUTOMEM_CURRENT_IMPERATIVE_MARKER',
    kind: 'additionalContext',
    text: CURRENT_IMPERATIVE_TEXT,
  },
  {
    name: 'neutral-factual',
    marker: 'AUTOMEM_NEUTRAL_FACTUAL_MARKER',
    kind: 'additionalContext',
    text: NEUTRAL_FACTUAL_TEXT,
  },
  {
    name: 'plain-stdout',
    marker: 'AUTOMEM_PLAIN_STDOUT_MARKER',
    kind: 'stdout',
    text: PLAIN_STDOUT_TEXT,
  },
];

function usage() {
  return `Usage:
  npm run probe:claude-stop-context -- [options]
  node scripts/probe-claude-stop-additional-context.mjs [options]

Runs real Claude Code Stop hooks in a temp project and compares three variants:
  current-imperative  additionalContext with command-like wording
  neutral-factual     additionalContext with factual AutoMem state
  plain-stdout        negative control that prints plain stdout

Options:
  --claude-bin <path>       Claude Code executable (default: claude)
  --prompt <text>           Prompt sent to claude -p
  --max-budget-usd <value>  Budget guard for each run (default: 0.20)
  --keep-temp               Keep the temp project and debug files
  --json                    Print JSON results instead of a text report
  -h, --help                Show this help without invoking Claude Code
`;
}

function parseArgs(argv) {
  const options = {
    claudeBin: 'claude',
    prompt: 'Reply exactly: automem-stop-probe-ok',
    maxBudgetUsd: '0.20',
    keepTemp: false,
    json: false,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '-h' || arg === '--help') {
      options.help = true;
    } else if (arg === '--keep-temp') {
      options.keepTemp = true;
    } else if (arg === '--json') {
      options.json = true;
    } else if (arg === '--claude-bin') {
      options.claudeBin = requireValue(argv, (index += 1), arg);
    } else if (arg === '--prompt') {
      options.prompt = requireValue(argv, (index += 1), arg);
    } else if (arg === '--max-budget-usd') {
      options.maxBudgetUsd = requireValue(argv, (index += 1), arg);
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  return options;
}

function requireValue(argv, index, optionName) {
  const value = argv[index];
  if (!value || value.startsWith('--')) {
    throw new Error(`${optionName} requires a value`);
  }
  return value;
}

function jsonString(value) {
  return JSON.stringify(value);
}

function writeVariantProject(rootDir, variant) {
  const projectDir = path.join(rootDir, variant.name);
  const claudeDir = path.join(projectDir, '.claude');
  const hooksDir = path.join(claudeDir, 'hooks');
  fs.mkdirSync(hooksDir, { recursive: true });

  const hookPath = path.join(hooksDir, 'stop-hook.sh');
  const hookSource =
    variant.kind === 'stdout'
      ? ['#!/bin/bash', `printf '%s\\n' ${shellQuote(variant.text)}`, 'exit 0', ''].join('\n')
      : [
          '#!/bin/bash',
          `printf '{"suppressOutput":true,"hookSpecificOutput":{"hookEventName":"Stop","additionalContext":%s}}\\n' ${shellQuote(jsonString(variant.text))}`,
          'exit 0',
          '',
        ].join('\n');
  fs.writeFileSync(hookPath, hookSource, { mode: 0o755 });

  const settings = {
    hooks: {
      Stop: [
        {
          hooks: [
            {
              type: 'command',
              command: hookPath,
            },
          ],
        },
      ],
    },
  };
  fs.writeFileSync(path.join(claudeDir, 'settings.json'), `${JSON.stringify(settings, null, 2)}\n`);

  return { projectDir, hookPath, debugFile: path.join(projectDir, 'debug.log') };
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function runVariant(rootDir, variant, options) {
  const project = writeVariantProject(rootDir, variant);
  const args = [
    '-p',
    options.prompt,
    '--verbose',
    '--output-format',
    'stream-json',
    '--include-hook-events',
    '--debug-file',
    project.debugFile,
    '--setting-sources',
    'project',
    '--permission-mode',
    'default',
    '--max-budget-usd',
    options.maxBudgetUsd,
  ];

  const startedAt = Date.now();
  const result = spawnSync(options.claudeBin, args, {
    cwd: project.projectDir,
    encoding: 'utf8',
    timeout: 120_000,
    env: process.env,
  });
  const elapsedMs = Date.now() - startedAt;
  const stdout = result.stdout ?? '';
  const stderr = result.stderr ?? '';
  const debug = fs.existsSync(project.debugFile) ? fs.readFileSync(project.debugFile, 'utf8') : '';
  const stream = analyzeStream(stdout, variant.marker);

  return {
    variant: variant.name,
    marker: variant.marker,
    status: result.status,
    signal: result.signal,
    error: result.error ? String(result.error) : null,
    elapsedMs,
    projectDir: project.projectDir,
    debugFile: project.debugFile,
    assistantTextContainsMarker: stream.assistantTextContainsMarker,
    hookEventContainsMarker: stream.hookEventContainsMarker,
    nonHookStreamContainsMarker: stream.nonHookStreamContainsMarker,
    rawStdoutContainsMarker: stdout.includes(variant.marker),
    stderrContainsMarker: stderr.includes(variant.marker),
    debugContainsMarker: debug.includes(variant.marker),
    parsedJsonLines: stream.parsedJsonLines,
    unparsedLines: stream.unparsedLines,
    stdoutPreview: preview(stdout),
    stderrPreview: preview(stderr),
  };
}

function analyzeStream(stdout, marker) {
  const lines = stdout.split(/\r?\n/).filter(Boolean);
  let parsedJsonLines = 0;
  let unparsedLines = 0;
  let assistantTextContainsMarker = false;
  let hookEventContainsMarker = false;
  let nonHookStreamContainsMarker = false;

  for (const line of lines) {
    let record;
    try {
      record = JSON.parse(line);
      parsedJsonLines += 1;
    } catch {
      unparsedLines += 1;
      if (line.includes(marker)) {
        nonHookStreamContainsMarker = true;
      }
      continue;
    }

    const recordText = JSON.stringify(record);
    const isHook = /hook/i.test(
      [
        record.type,
        record.subtype,
        record.event,
        record.hook_event_name,
        record.hookEventName,
        record.name,
      ]
        .filter(Boolean)
        .join(' ')
    );
    const isAssistant =
      record.type === 'assistant' ||
      record.message?.role === 'assistant' ||
      record.role === 'assistant' ||
      record.type === 'content_block_delta';

    if (recordText.includes(marker)) {
      if (isHook) {
        hookEventContainsMarker = true;
      } else {
        nonHookStreamContainsMarker = true;
      }
    }

    if (isAssistant && collectStrings(record).some((value) => value.includes(marker))) {
      assistantTextContainsMarker = true;
    }
  }

  return {
    parsedJsonLines,
    unparsedLines,
    assistantTextContainsMarker,
    hookEventContainsMarker,
    nonHookStreamContainsMarker,
  };
}

function collectStrings(value, strings = []) {
  if (typeof value === 'string') {
    strings.push(value);
  } else if (Array.isArray(value)) {
    for (const item of value) {
      collectStrings(item, strings);
    }
  } else if (value && typeof value === 'object') {
    for (const item of Object.values(value)) {
      collectStrings(item, strings);
    }
  }
  return strings;
}

function preview(value) {
  const compact = String(value).replace(/\s+/g, ' ').trim();
  return compact.length > 500 ? `${compact.slice(0, 500)}...` : compact;
}

function assertClaudeAvailable(claudeBin) {
  try {
    execFileSync(claudeBin, ['--version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (error) {
    throw new Error(`Could not execute ${claudeBin}. Install Claude Code or pass --claude-bin. ${error}`);
  }
}

function printTextReport(results, rootDir, keepTemp) {
  console.log('Claude Code Stop additionalContext probe');
  console.log(`Temp project root: ${rootDir}${keepTemp ? '' : ' (removed after run)'}`);
  console.log('');
  for (const result of results) {
    console.log(`${result.variant}`);
    console.log(`  status: ${result.status}${result.signal ? ` signal=${result.signal}` : ''}`);
    console.log(`  marker in assistant text: ${result.assistantTextContainsMarker}`);
    console.log(`  marker in non-hook stream records: ${result.nonHookStreamContainsMarker}`);
    console.log(`  marker in hook event records: ${result.hookEventContainsMarker}`);
    console.log(`  marker in raw stdout: ${result.rawStdoutContainsMarker}`);
    console.log(`  marker in debug log: ${result.debugContainsMarker}`);
    console.log(`  debug log: ${result.debugFile}`);
    if (result.error) {
      console.log(`  error: ${result.error}`);
    }
    if (result.stderrPreview) {
      console.log(`  stderr: ${result.stderrPreview}`);
    }
  }
  console.log('');
  console.log('Interpretation: hidden Stop additionalContext should not put the marker in assistant text or non-hook stream records. The plain-stdout control should appear in raw stdout or hook event records, proving hook output capture is active.');
}

function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    console.error('');
    console.error(usage());
    process.exit(2);
  }

  if (options.help) {
    process.stdout.write(usage());
    return;
  }

  assertClaudeAvailable(options.claudeBin);
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'automem-stop-context-'));
  const results = [];
  try {
    for (const variant of VARIANTS) {
      results.push(runVariant(rootDir, variant, options));
    }
    if (options.json) {
      console.log(JSON.stringify({ rootDir, variants: results }, null, 2));
    } else {
      printTextReport(results, rootDir, options.keepTemp);
    }
  } finally {
    if (!options.keepTemp) {
      fs.rmSync(rootDir, { recursive: true, force: true });
    }
  }
}

main();
