import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  detectProjectName,
  log,
  parseCommonFlags,
  replaceTemplateVars,
  writeFileWithBackup,
} from './host-toolkit.js';
import { planCursorHooks, planCursorMcpSetup, writeCursorMcpDocument } from './cursor-config.js';

export interface CursorSetupOptions {
  targetDir?: string;
  projectDir?: string;
  projectName?: string;
  endpoint?: string;
  apiKey?: string;
  dryRun?: boolean;
  quiet?: boolean;
  skipPrompts?: boolean;
}

const TEMPLATE_ROOT = fileURLToPath(new URL('../../templates/cursor/', import.meta.url));

export async function applyCursorSetup(options: CursorSetupOptions): Promise<void> {
  const projectDir = path.resolve(options.projectDir ?? process.cwd());
  const projectName = options.projectName ?? detectProjectName(projectDir);
  const rulePath = path.resolve(
    options.targetDir ?? path.join(projectDir, '.cursor', 'rules'),
    'automem.mdc'
  );
  const hooksPath = path.join(projectDir, '.cursor', 'hooks.json');
  const scriptPath = path.join(projectDir, '.cursor', 'hooks', 'automem-session-start.mjs');

  // Preflight every JSON document and read every template before making any changes.
  const mcp = planCursorMcpSetup(projectDir, options);
  const hooks = planCursorHooks(hooksPath);
  const vars = {
    PROJECT_NAME: projectName,
    MCP_SERVER_NAME: mcp.serverName,
    MCP_TOOL_PREFIX: `mcp_${mcp.serverName.replace(/[^A-Za-z0-9_]/g, '_')}_`,
  };
  const rule = replaceTemplateVars(
    fs.readFileSync(path.join(TEMPLATE_ROOT, 'automem.mdc.template'), 'utf8'),
    vars
  );
  // Runtime values are serialized as JavaScript strings, never interpolated into code.
  const script = fs
    .readFileSync(path.join(TEMPLATE_ROOT, 'session-start.mjs.template'), 'utf8')
    .replace('"{{CURSOR_RECALL_CONTEXT}}"', () =>
      JSON.stringify(
        replaceTemplateVars(
          fs.readFileSync(path.join(TEMPLATE_ROOT, 'session-start-context.md'), 'utf8'),
          vars
        )
      )
    );

  log(`\nSetting up Cursor AutoMem for ${projectName}`, options.quiet);
  writeCursorMcpDocument(mcp.configPath, mcp.document, options);
  writeFileWithBackup(rulePath, rule, options);
  writeFileWithBackup(scriptPath, script, options);
  writeFileWithBackup(hooksPath, `${JSON.stringify(hooks, null, 2)}\n`, options);
  log(
    options.dryRun
      ? '\nCursor setup preview complete; no files changed.'
      : '\nCursor configuration installed. Open a new Agent conversation and approve the memory MCP server when prompted.',
    options.quiet
  );
  log(
    'The session-start hook guides recall; the always-on rule supplies the fallback. Memory storage remains model-judged.',
    options.quiet
  );
}

export async function runCursorSetup(args: string[] = []): Promise<void> {
  let endpoint: string | undefined;
  let apiKey: string | undefined;
  const common = parseCommonFlags(args, {
    '--endpoint': {
      kind: 'value',
      set: (value) => {
        endpoint = value;
      },
    },
    '--api-key': {
      kind: 'value',
      set: (value) => {
        apiKey = value;
      },
    },
    '--desc': { kind: 'value', set: () => {} },
    '--description': { kind: 'value', set: () => {} },
  });
  await applyCursorSetup({ ...common, endpoint, apiKey, skipPrompts: common.yes });
}
