/**
 * CLI smoke tests - verify commands work without side effects unless the test
 * explicitly targets generated files in a temp workspace/home.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'child_process';
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

  it('templates should have version markers', () => {
    const cursorTemplate = fs.readFileSync(
      path.resolve(__dirname, '../../templates/cursor/automem.mdc.template'),
      'utf8'
    );
    expect(cursorTemplate).toMatch(/automem-template-version:\s*[\d.]+/);

    const userRulesTemplate = fs.readFileSync(
      path.resolve(__dirname, '../../templates/cursor/user-rules.md'),
      'utf8'
    );
    expect(userRulesTemplate).toMatch(/automem-template-version:\s*[\d.]+/);

    const codexTemplate = fs.readFileSync(
      path.resolve(__dirname, '../../templates/codex/memory-rules.md'),
      'utf8'
    );
    expect(codexTemplate).toMatch(/automem-template-version:\s*[\d.]+/);

    const openClawPluginSkill = fs.readFileSync(
      path.resolve(__dirname, '../../skills/automem/SKILL.md'),
      'utf8'
    );
    expect(openClawPluginSkill).toMatch(/automem-template-version:\s*[\d.]+/);
  });

  it('cursor project template should include operational memory workflow', () => {
    const cursorTemplate = fs.readFileSync(
      path.resolve(__dirname, '../../templates/cursor/automem.mdc.template'),
      'utf8'
    );

    expect(cursorTemplate).toContain('store_memory');
    expect(cursorTemplate).toContain('associate_memories');
    expect(cursorTemplate).toContain('## Tagging Convention');
    expect(cursorTemplate).toContain('Use recalled memory as context, not as unquestionable truth');
    expect(cursorTemplate).toContain('Associate memories only when the relationship is explicit, durable, and useful');
    expect(cursorTemplate).toContain('## Optional GPT-5.4 Overlay');
    expect(cursorTemplate).toContain('query: "personal coding preferences {{PROJECT_NAME}} collaboration style"');
    expect(cursorTemplate).toContain('Avoid platform tags like `cursor` on recall');
  });

  it('cursor user rules template should stay thin', () => {
    const userRulesTemplate = fs.readFileSync(
      path.resolve(__dirname, '../../templates/cursor/user-rules.md'),
      'utf8'
    );

    expect(userRulesTemplate).toContain('personal coding preferences <project-name> collaboration style');
    expect(userRulesTemplate).toContain('current repo state or the latest user instruction');
    expect(userRulesTemplate).not.toContain('store_memory');
    expect(userRulesTemplate).not.toContain('associate_memories');
    expect(userRulesTemplate).not.toContain('## Optional GPT-5.4 Overlay');
    expect(userRulesTemplate).not.toContain('Tagging Convention');
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
});
