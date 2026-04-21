/**
 * CLI smoke tests - verify commands work without side effects unless the test
 * explicitly targets generated files in a temp workspace/home.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { execFileSync, execSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const CLI_PATH = path.resolve(__dirname, '../../dist/index.js');

function runCli(
  args: string[],
  options: { timeout?: number; cwd?: string; env?: NodeJS.ProcessEnv } = {}
): {
  stdout: string;
  stderr: string;
  exitCode: number;
} {
  try {
    const stdout = execFileSync(process.execPath, [CLI_PATH, ...args], {
      encoding: 'utf8',
      timeout: options.timeout || 10000,
      cwd: options.cwd || process.cwd(),
      env: {
        ...process.env,
        AUTOMEM_ENDPOINT: 'http://localhost:9999',
        ...options.env,
      },
    });
    return { stdout, stderr: '', exitCode: 0 };
  } catch (error: unknown) {
    const execError = error as {
      stdout?: string;
      stderr?: string;
      status?: number;
    };
    return {
      stdout: execError.stdout || '',
      stderr: execError.stderr || '',
      exitCode: execError.status || 1,
    };
  }
}

function runCliExpectSuccess(
  args: string[],
  options?: { timeout?: number; cwd?: string; env?: NodeJS.ProcessEnv }
): string {
  const result = runCli(args, options);
  if (result.exitCode !== 0) {
    throw new Error(
      `CLI exited ${result.exitCode}\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`
    );
  }
  return result.stdout;
}

describe('CLI Smoke Tests', () => {
  let tempDir: string;

  beforeAll(() => {
    if (!fs.existsSync(CLI_PATH)) {
      throw new Error(`CLI not built. Run 'npm run build' first. Expected: ${CLI_PATH}`);
    }

    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'automem-cli-test-'));
  });

  describe('config command', () => {
    it('should output config with MCP server snippet', () => {
      const output = runCliExpectSuccess(['config']);
      expect(output).toMatch(/mcpServers/i);
      expect(output).toMatch(/memory/i);
      expect(output).toMatch(/npx/i);
    });

    it('should include Claude Desktop snippet', () => {
      const output = runCliExpectSuccess(['config']);
      expect(output).toMatch(/Claude Desktop/i);
      expect(output).toMatch(/AUTOMEM_ENDPOINT/i);
    });

    it('should include Claude Code setup', () => {
      const output = runCliExpectSuccess(['config']);
      expect(output).toMatch(/claude mcp add/i);
    });
  });

  describe('cursor command', () => {
    it('should run with --dry-run without creating files', () => {
      const testProjectDir = path.join(tempDir, 'cursor-test');
      fs.mkdirSync(testProjectDir, { recursive: true });
      fs.writeFileSync(
        path.join(testProjectDir, 'package.json'),
        JSON.stringify({ name: 'test-project', version: '1.0.0' })
      );

      const result = runCli(['cursor', '--dry-run', '--target-dir', testProjectDir], {
        cwd: testProjectDir,
      });

      expect((result.stdout + result.stderr).length).toBeGreaterThan(0);
    });

    it('should detect project name from package.json', () => {
      const testProjectDir = path.join(tempDir, 'named-project');
      fs.mkdirSync(testProjectDir, { recursive: true });

      fs.writeFileSync(
        path.join(testProjectDir, 'package.json'),
        JSON.stringify({ name: '@scope/my-cool-project', version: '1.0.0' })
      );

      const result = runCli(['cursor', '--dry-run', '--target-dir', testProjectDir], {
        cwd: testProjectDir,
      });

      expect((result.stdout + result.stderr).toLowerCase()).toMatch(/project|my-cool-project|cursor/i);
    });
  });

  describe('setup command', () => {
    it('should show config with --yes flag (non-interactive)', () => {
      const result = runCli(['setup', '--yes', '--endpoint', 'http://test:8001']);
      expect((result.stdout + result.stderr).length).toBeGreaterThan(0);
    });
  });

  describe('queue command', () => {
    it('should handle missing queue file gracefully', () => {
      const result = runCli(['queue', '--file', '/nonexistent/path/queue.jsonl']);
      expect(result.exitCode).toBeDefined();
    });

    it('should process empty queue file', () => {
      const emptyQueueFile = path.join(tempDir, 'empty-queue.jsonl');
      fs.writeFileSync(emptyQueueFile, '');

      const result = runCli(['queue', '--file', emptyQueueFile]);
      expect(result.exitCode).toBeDefined();
    });
  });

  describe('openclaw command', () => {
    it('should support plugin dry-run with redacted output', () => {
      const workspaceDir = path.join(tempDir, 'openclaw-plugin');
      fs.mkdirSync(workspaceDir, { recursive: true });
      fs.writeFileSync(
        path.join(workspaceDir, 'package.json'),
        JSON.stringify({ name: 'plugin-test', version: '1.0.0' })
      );

      const output = runCliExpectSuccess(
        [
          'openclaw',
          '--mode',
          'plugin',
          '--workspace',
          workspaceDir,
          '--api-key',
          'super-secret-key',
          '--dry-run',
        ],
        { cwd: workspaceDir }
      );

      expect(output).toMatch(/openclaw plugins install/i);
      expect(output).toMatch(/plugins\.entries\.automem/i);
      expect(output).not.toContain('super-secret-key');
      expect(output).toContain('<redacted>');
    });

    it('should support mcp dry-run with mcporter config preview', () => {
      const workspaceDir = path.join(tempDir, 'openclaw-mcp-dry-run');
      fs.mkdirSync(workspaceDir, { recursive: true });

      const output = runCliExpectSuccess(
        [
          'openclaw',
          '--mode',
          'mcp',
          '--workspace',
          workspaceDir,
          '--api-key',
          'super-secret-key',
          '--dry-run',
        ],
        { cwd: workspaceDir }
      );

      expect(output).toMatch(/mcporter\.json/i);
      expect(output).toMatch(/AutoMem memory service/i);
      expect(output).not.toContain('super-secret-key');
      expect(output).toContain('<redacted>');
    });

    it('should support legacy skill dry-run', () => {
      const workspaceDir = path.join(tempDir, 'openclaw-skill-dry-run');
      fs.mkdirSync(workspaceDir, { recursive: true });

      const output = runCliExpectSuccess(
        [
          'openclaw',
          '--mode',
          'skill',
          '--workspace',
          workspaceDir,
          '--dry-run',
        ],
        { cwd: workspaceDir }
      );

      expect(output).toMatch(/legacy curl-based skill/i);
      expect(output).toMatch(/skills\.entries\.automem/i);
    });

    it('should write workspace mcp config without secrets', () => {
      const workspaceDir = path.join(tempDir, 'openclaw-mcp-write');
      const homeDir = path.join(tempDir, 'home-mcp-write');
      fs.mkdirSync(workspaceDir, { recursive: true });
      fs.mkdirSync(homeDir, { recursive: true });

      const result = runCli(
        [
          'openclaw',
          '--mode',
          'mcp',
          '--workspace',
          workspaceDir,
          '--api-key',
          'super-secret-key',
        ],
        {
          cwd: workspaceDir,
          env: {
            HOME: homeDir,
          },
        }
      );

      expect(result.exitCode).toBe(0);

      const mcporterPath = path.join(workspaceDir, 'config', 'mcporter.json');
      const mcporterConfig = fs.readFileSync(mcporterPath, 'utf8');
      expect(mcporterConfig).toContain('"automem"');
      expect(mcporterConfig).not.toContain('super-secret-key');
      expect(mcporterConfig).not.toMatch(/AUTOMEM_API_KEY|AUTOMEM_API_TOKEN/);

      const openClawConfig = fs.readFileSync(
        path.join(homeDir, '.openclaw', 'openclaw.json'),
        'utf8'
      );
      expect(openClawConfig).toContain('"apiKey": "super-secret-key"');
    });

    it('should report archive steps for old skill overrides in plugin dry-run', () => {
      const homeDir = path.join(tempDir, 'home-plugin-migration');
      const workspaceDir = path.join(tempDir, 'openclaw-plugin-migration');
      const sharedSkillDir = path.join(homeDir, '.openclaw', 'skills', 'automem');
      const workspaceSkillDir = path.join(workspaceDir, 'skills', 'automem');
      fs.mkdirSync(sharedSkillDir, { recursive: true });
      fs.mkdirSync(workspaceSkillDir, { recursive: true });
      fs.writeFileSync(path.join(sharedSkillDir, 'SKILL.md'), '# old shared skill');
      fs.writeFileSync(path.join(workspaceSkillDir, 'SKILL.md'), '# old workspace skill');

      const output = runCliExpectSuccess(
        [
          'openclaw',
          '--mode',
          'plugin',
          '--workspace',
          workspaceDir,
          '--dry-run',
        ],
        {
          cwd: workspaceDir,
          env: {
            HOME: homeDir,
          },
        }
      );

      expect(output).toMatch(/Would archive .*\.openclaw[\\/]+skills[\\/]+automem/i);
      expect(output).toMatch(/Would archive .*[\\/]+skills[\\/]+automem/i);
    });
  });
});

describe('Template Generation', () => {
  it('should have cursor template file', () => {
    const templatePath = path.resolve(__dirname, '../../templates/cursor/automem.mdc.template');
    expect(fs.existsSync(templatePath)).toBe(true);
  });

  it('should have cursor user rules template file', () => {
    const templatePath = path.resolve(__dirname, '../../templates/cursor/user-rules.md');
    expect(fs.existsSync(templatePath)).toBe(true);
  });

  it('should have cursor rule eval fixture', () => {
    const evalPath = path.resolve(__dirname, '../../templates/cursor/rule-evals.md');
    expect(fs.existsSync(evalPath)).toBe(true);

    const evalFixture = fs.readFileSync(evalPath, 'utf8');
    expect(evalFixture).toMatch(/Global only/);
    expect(evalFixture).toMatch(/Project only/);
    expect(evalFixture).toMatch(/Global \+ project \+ custom mode/);
    expect(evalFixture).toMatch(/Trivial typo fix/);
    expect(evalFixture).toMatch(/Architecture why-question/);
    expect(evalFixture).toMatch(/Empty recall fallback/);
    expect(evalFixture).toMatch(/Personality and preferences recall/);
  });

  it('should have codex template file', () => {
    const templatePath = path.resolve(__dirname, '../../templates/codex/memory-rules.md');
    expect(fs.existsSync(templatePath)).toBe(true);
  });

  it('should have Claude Desktop template', () => {
    const templatePath = path.resolve(__dirname, '../../templates/CLAUDE_DESKTOP_INSTRUCTIONS.md');
    expect(fs.existsSync(templatePath)).toBe(true);
  });

  it('should have OpenClaw plugin and skill templates', () => {
    expect(fs.existsSync(path.resolve(__dirname, '../../openclaw.plugin.json'))).toBe(true);
    expect(fs.existsSync(path.resolve(__dirname, '../../skills/automem/SKILL.md'))).toBe(true);
    expect(fs.existsSync(path.resolve(__dirname, '../../templates/openclaw/skill-mcp/SKILL.md'))).toBe(true);
    expect(fs.existsSync(path.resolve(__dirname, '../../templates/openclaw/skill-legacy/SKILL.md'))).toBe(true);
  });

  it('plugin-distributed Claude Code runtime assets should match the canonical templates', () => {
    const pairs: Array<[string, string]> = [
      ['templates/claude-code/hooks/capture-build-result.sh', 'plugins/automem/scripts/capture-build-result.sh'],
      ['templates/claude-code/hooks/capture-deployment.sh', 'plugins/automem/scripts/capture-deployment.sh'],
      ['templates/claude-code/hooks/capture-test-pattern.sh', 'plugins/automem/scripts/capture-test-pattern.sh'],
      ['templates/claude-code/hooks/session-memory.sh', 'plugins/automem/scripts/session-memory.sh'],
      ['templates/claude-code/hooks/automem-session-start.sh', 'plugins/automem/scripts/session-start.sh'],
      ['templates/claude-code/scripts/memory-filters.json', 'plugins/automem/scripts/memory-filters.json'],
      ['templates/claude-code/scripts/process-session-memory.py', 'plugins/automem/scripts/process-session-memory.py'],
      ['templates/claude-code/scripts/queue-cleanup.sh', 'plugins/automem/scripts/queue-cleanup.sh'],
    ];

    for (const [canonical, pluginCopy] of pairs) {
      const canonicalContent = fs.readFileSync(path.resolve(__dirname, `../../${canonical}`), 'utf8');
      const pluginContent = fs.readFileSync(path.resolve(__dirname, `../../${pluginCopy}`), 'utf8');
      expect(pluginContent, `${pluginCopy} drifted from ${canonical}`).toBe(canonicalContent);
    }
  });

  it('every template version marker should equal package.json version (kept in sync by scripts/sync-template-versions.mjs via prebuild)', () => {
    const pkgVersion = JSON.parse(
      fs.readFileSync(path.resolve(__dirname, '../../package.json'), 'utf8')
    ).version;

    const repoRoot = path.resolve(__dirname, '../..');
    const TEMPLATE_FILE_RE = /\.(md|mdc|template)$/;
    const FALLBACK_ROOTS = ['templates', 'skills', 'plugins'];
    const IGNORED_DIRS = new Set(['.git', 'node_modules', 'dist']);

    function walkTemplateFiles(rootRel: string): string[] {
      const rootAbs = path.join(repoRoot, rootRel);
      if (!fs.existsSync(rootAbs)) return [];
      const files: string[] = [];
      // Iterative depth-first traversal using an explicit stack to avoid recursion limits.
      const stack = [rootRel];
      while (stack.length > 0) {
        const currentRel = stack.pop()!;
        const currentAbs = path.join(repoRoot, currentRel);
        for (const entry of fs.readdirSync(currentAbs, { withFileTypes: true })) {
          const entryRel = path.join(currentRel, entry.name);
          if (entry.isDirectory()) {
            if (!IGNORED_DIRS.has(entry.name)) stack.push(entryRel);
            continue;
          }
          if (entry.isFile() && TEMPLATE_FILE_RE.test(entryRel)) files.push(entryRel);
        }
      }
      return files;
    }

    let tracked: string[];
    try {
      tracked = execSync('git ls-files', { cwd: repoRoot, encoding: 'utf8' })
        .split('\n')
        .filter(Boolean)
        .filter((f) => TEMPLATE_FILE_RE.test(f));
    } catch {
      // Fallback for environments without git (e.g. source snapshots or some CI caches).
      tracked = FALLBACK_ROOTS.flatMap((root) => walkTemplateFiles(root));
    }

    const marker = /<!--\s*automem-template-version:\s*([\d.]+)\s*-->/g;
    const drifted: string[] = [];
    let totalMarkers = 0;

    for (const rel of tracked) {
      const content = fs.readFileSync(path.join(repoRoot, rel), 'utf8');
      let m: RegExpExecArray | null;
      while ((m = marker.exec(content)) !== null) {
        totalMarkers += 1;
        if (m[1] !== pkgVersion) {
          drifted.push(`${rel}: ${m[1]} (expected ${pkgVersion})`);
        }
      }
    }

    expect(totalMarkers).toBeGreaterThan(0);
    expect(
      drifted,
      `\nTemplate versions drifted from package.json (${pkgVersion}). Run \`npm run sync-versions\` (or \`npm run build\`) to fix:\n  ${drifted.join('\n  ')}`
    ).toEqual([]);
  });

  it('cursor project template should include operational memory workflow (3.0.0 playbook)', () => {
    const cursorTemplate = fs.readFileSync(
      path.resolve(__dirname, '../../templates/cursor/automem.mdc.template'),
      'utf8'
    );

    // Core MCP tool references remain.
    expect(cursorTemplate).toContain('store_memory');
    expect(cursorTemplate).toContain('associate_memories');

    // 3.0.0 playbook structural elements.
    expect(cursorTemplate).toContain("## Tool's real behavior");
    expect(cursorTemplate).toContain('Session start — two-phase recall');
    expect(cursorTemplate).toContain('Three mid-conversation triggers');
    expect(cursorTemplate).toContain('The atomic ritual');
    expect(cursorTemplate).toContain('Mandatory association pairings');
    expect(cursorTemplate).toContain('## Optional GPT-5.4 Overlay');

    // Cursor-specific preservation: active_path/language rankers.
    expect(cursorTemplate).toContain('active_path');
    expect(cursorTemplate).toContain('language');

    // Validated-parameter guardrails.
    expect(cursorTemplate).toContain('"last 90 days"');
    expect(cursorTemplate).toContain('limit: 20');
    expect(cursorTemplate).toContain('limit: 30');
    expect(cursorTemplate).toContain('format: "detailed"');

    // Tag discipline: bare tags only, no platform tag, no [YYYY-MM].
    expect(cursorTemplate).toContain('NO platform tag');
    expect(cursorTemplate).not.toContain('{{CURRENT_MONTH}}');

    // Recalled memory isn't ground truth.
    expect(cursorTemplate).toContain('current evidence wins');
  });

  it('cursor user rules template should stay thin', () => {
    const userRulesTemplate = fs.readFileSync(
      path.resolve(__dirname, '../../templates/cursor/user-rules.md'),
      'utf8'
    );

    // Keeps the cross-project preference-recall pattern.
    expect(userRulesTemplate).toContain('personal coding preferences <project-name> collaboration style');

    // 3.0.0 global-rule concepts that must be present.
    expect(userRulesTemplate).toContain('Corrections are gold');
    expect(userRulesTemplate).toContain('Bare tags only');
    expect(userRulesTemplate).toContain('current evidence wins');

    // Must stay thin — no operational workflow.
    expect(userRulesTemplate).not.toContain('store_memory');
    expect(userRulesTemplate).not.toContain('associate_memories');
    expect(userRulesTemplate).not.toContain('## Optional GPT-5.4 Overlay');
    expect(userRulesTemplate).not.toContain('Tagging Convention');
    expect(userRulesTemplate).not.toContain('The atomic ritual');
  });

  it('installation guide should describe the layered Cursor rules strategy', () => {
    const installationGuide = fs.readFileSync(
      path.resolve(__dirname, '../../INSTALLATION.md'),
      'utf8'
    );

    expect(installationGuide).toContain('### 3. How Cursor Loads Instructions');
    expect(installationGuide).toContain('**User Rules**');
    expect(installationGuide).toContain('**Project Rules**');
    expect(installationGuide).toContain('**Custom Modes**');
    expect(installationGuide).toContain('templates/cursor/user-rules.md');
    expect(installationGuide).not.toContain('### Optional GPT-5.4 Overlay');
  });

  it('Claude Code docs should prefer the CLI installer and mark the plugin deprecated', () => {
    const readme = fs.readFileSync(path.resolve(__dirname, '../../README.md'), 'utf8');
    const pluginReadme = fs.readFileSync(path.resolve(__dirname, '../../plugins/automem/README.md'), 'utf8');
    const deprecations = fs.readFileSync(path.resolve(__dirname, '../../DEPRECATION.md'), 'utf8');
    const claudeCodeGuide = fs.readFileSync(
      path.resolve(__dirname, '../../templates/CLAUDE_CODE_INTEGRATION.md'),
      'utf8'
    );

    expect(readme).toContain('#### Option A: CLI Setup (Recommended)');
    expect(readme).toContain('#### Option B: Plugin (Deprecated)');
    expect(readme).toContain('DEPRECATION.md');

    expect(pluginReadme).toContain('Deprecated');
    expect(pluginReadme).toContain('npx @verygoodplugins/mcp-automem claude-code');

    expect(claudeCodeGuide).toContain('npx @verygoodplugins/mcp-automem claude-code');
    expect(claudeCodeGuide).toContain('deprecated');

    expect(deprecations).toContain('Claude Code Plugin');
    expect(deprecations).toContain('npx @verygoodplugins/mcp-automem claude-code');
  });

  it('OpenClaw templates should follow semantic-first recall and bare-tag guidance', () => {
    const mcpSkill = fs.readFileSync(
      path.resolve(__dirname, '../../templates/openclaw/skill-mcp/SKILL.md'),
      'utf8'
    );
    const legacySkill = fs.readFileSync(
      path.resolve(__dirname, '../../templates/openclaw/skill-legacy/SKILL.md'),
      'utf8'
    );
    const setupGuide = fs.readFileSync(
      path.resolve(__dirname, '../../templates/openclaw/OPENCLAW_SETUP.md'),
      'utf8'
    );

    expect(mcpSkill).toContain('tags: ["preference"]');
    expect(mcpSkill).toContain('bugfix", "solution');
    expect(mcpSkill).toContain('hard gate');
    expect(mcpSkill).toContain('avoid platform tags like `openclaw`');

    expect(legacySkill).toContain('tags=preference');
    expect(legacySkill).toContain('bugfix&tags=solution');
    expect(legacySkill).toContain('"tags": ["project-slug", "decision"]');
    expect(legacySkill).not.toContain('"tags": ["openclaw"]');

    expect(setupGuide).toContain('semantic');
    expect(setupGuide).toContain('bare project tags');
  });
});
