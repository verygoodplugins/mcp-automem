#!/usr/bin/env tsx
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  renderClaudeCodeSessionStartHook,
  renderClaudeDesktopInstructions,
  renderClaudeMdMemoryRules,
  renderCodexMemoryRules,
  renderCursorProjectRule,
  renderHermesMemoryRules,
  renderHermesProviderPolicyPython,
} from '../src/memory-policy/shared.js';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function readPackageVersion(): string {
  const pkg = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8')) as {
    version?: string;
  };
  return pkg.version || '0.0.0';
}

function writeIfChanged(relativePath: string, content: string): boolean {
  const targetPath = join(REPO_ROOT, relativePath);
  if (existsSync(targetPath) && readFileSync(targetPath, 'utf8') === content) {
    return false;
  }
  mkdirSync(dirname(targetPath), { recursive: true });
  writeFileSync(targetPath, content, 'utf8');
  console.log(`  synced ${relative(REPO_ROOT, targetPath)}`);
  return true;
}

const templateVersion = readPackageVersion();
const hook = renderClaudeCodeSessionStartHook();
const files: Array<[string, string]> = [
  ['templates/claude-code/hooks/automem-session-start.sh', hook],
  ['plugins/automem/scripts/session-start.sh', hook],
  [
    'templates/codex/memory-rules.md',
    renderCodexMemoryRules({ projectName: '{{PROJECT_NAME}}', templateVersion }),
  ],
  [
    'templates/cursor/automem.mdc.template',
    renderCursorProjectRule({
      projectName: '{{PROJECT_NAME}}',
      mcpServerName: '{{MCP_SERVER_NAME}}',
      mcpToolPrefix: '{{MCP_TOOL_PREFIX}}',
      templateVersion,
    }),
  ],
  [
    'templates/CLAUDE_DESKTOP_INSTRUCTIONS.md',
    renderClaudeDesktopInstructions({ templateVersion }),
  ],
  [
    'templates/CLAUDE_MD_MEMORY_RULES.md',
    renderClaudeMdMemoryRules({ templateVersion }),
  ],
  [
    'templates/hermes/memory-rules.md',
    renderHermesMemoryRules({
      projectName: '{{PROJECT_NAME}}',
      modeRules: '{{HERMES_MODE_RULES}}',
      templateVersion,
    }),
  ],
  ['templates/hermes/provider/automem_policy.py', renderHermesProviderPolicyPython()],
];

const changed = files.reduce((count, [relativePath, content]) => {
  return count + (writeIfChanged(relativePath, content) ? 1 : 0);
}, 0);

console.log(
  changed === 0
    ? `✓ memory policy artifacts already in sync (${files.length} files scanned)`
    : `✓ synced ${changed} memory policy artifact${changed === 1 ? '' : 's'}`
);
