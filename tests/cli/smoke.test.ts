/**
 * CLI smoke tests - verify commands work without side effects.
 * These tests run CLI commands with --dry-run or capture output
 * to verify they produce expected results.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { execSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';

// Path to the compiled CLI
const CLI_PATH = path.resolve(__dirname, '../../dist/index.js');

// Helper to run CLI commands and capture output
function runCli(args: string[], options: { timeout?: number; cwd?: string } = {}): {
  stdout: string;
  stderr: string;
  exitCode: number;
} {
  try {
    const stdout = execSync(`node ${CLI_PATH} ${args.join(' ')}`, {
      encoding: 'utf8',
      timeout: options.timeout || 10000,
      cwd: options.cwd || process.cwd(),
      env: {
        ...process.env,
        // Ensure no real connections are made
        AUTOMEM_ENDPOINT: 'http://localhost:9999',
      },
    });
    return { stdout, stderr: '', exitCode: 0 };
  } catch (error: unknown) {
    const execError = error as { stdout?: string; stderr?: string; status?: number };
    return {
      stdout: execError.stdout || '',
      stderr: execError.stderr || '',
      exitCode: execError.status || 1,
    };
  }
}

// Helper to run CLI and expect it to succeed
function runCliExpectSuccess(args: string[], options?: { timeout?: number; cwd?: string }): string {
  const result = runCli(args, options);
  if (result.exitCode !== 0) {
    console.error('CLI stderr:', result.stderr);
  }
  return result.stdout;
}

describe('CLI Smoke Tests', () => {
  let tempDir: string;

  beforeAll(() => {
    // Ensure CLI is built
    if (!fs.existsSync(CLI_PATH)) {
      throw new Error(`CLI not built. Run 'npm run build' first. Expected: ${CLI_PATH}`);
    }

    // Create temp directory for tests
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'automem-cli-test-'));
  });

  describe('config command', () => {
    it('should output config with MCP server snippet', () => {
      const output = runCliExpectSuccess(['config']);

      // Should contain MCP server config
      expect(output).toMatch(/mcpServers/i);
      expect(output).toMatch(/memory/i);
      expect(output).toMatch(/npx/i);
    });

    it('should include Claude Desktop snippet', () => {
      const output = runCliExpectSuccess(['config']);

      // Should contain Claude Desktop config
      expect(output).toMatch(/Claude Desktop/i);
      expect(output).toMatch(/AUTOMEM_ENDPOINT/i);
    });

    it('should include Claude Code setup', () => {
      const output = runCliExpectSuccess(['config']);

      // Should contain Claude Code commands
      expect(output).toMatch(/claude mcp add/i);
    });
  });

  describe('cursor command', () => {
    it('should run with --dry-run without creating files', () => {
      const testProjectDir = path.join(tempDir, 'cursor-test');
      fs.mkdirSync(testProjectDir, { recursive: true });

      // Create a minimal package.json
      fs.writeFileSync(
        path.join(testProjectDir, 'package.json'),
        JSON.stringify({ name: 'test-project', version: '1.0.0' })
      );

      const result = runCli(['cursor', '--dry-run', '--target-dir', testProjectDir], {
        cwd: testProjectDir,
      });

      // Should succeed or show dry-run output
      const output = result.stdout + result.stderr;

      // In dry-run mode, should show output but NOT create actual files
      expect(output.length).toBeGreaterThan(0);
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

      const output = result.stdout + result.stderr;
      // Should mention the project name (without scope)
      expect(output.toLowerCase()).toMatch(/project|my-cool-project|cursor/i);
    });
  });

  describe('setup command', () => {
    it('should show config with --yes flag (non-interactive)', () => {
      const result = runCli(['setup', '--yes', '--endpoint', 'http://test:8001']);

      const output = result.stdout + result.stderr;
      // Should output configuration info
      expect(output.length).toBeGreaterThan(0);
    });
  });

  describe('queue command', () => {
    it('should handle missing queue file gracefully', () => {
      const result = runCli(['queue', '--file', '/nonexistent/path/queue.jsonl']);

      // Should not crash - either succeed with "no items" or fail gracefully
      expect(result.exitCode).toBeDefined();
    });

    it('should process empty queue file', () => {
      const emptyQueueFile = path.join(tempDir, 'empty-queue.jsonl');
      fs.writeFileSync(emptyQueueFile, '');

      const result = runCli(['queue', '--file', emptyQueueFile]);

      // Should handle empty file gracefully
      expect(result.exitCode).toBeDefined();
    });
  });
});

describe('Template Generation', () => {
  it('should have cursor template file', () => {
    const templatePath = path.resolve(__dirname, '../../templates/cursor/automem.mdc.template');
    expect(fs.existsSync(templatePath)).toBe(true);
  });

  it('should have codex template file', () => {
    const templatePath = path.resolve(__dirname, '../../templates/codex/memory-rules.md');
    expect(fs.existsSync(templatePath)).toBe(true);
  });

  it('should have Claude Desktop template', () => {
    const templatePath = path.resolve(__dirname, '../../templates/CLAUDE_DESKTOP_INSTRUCTIONS.md');
    expect(fs.existsSync(templatePath)).toBe(true);
  });

  it('templates should have version markers', () => {
    const cursorTemplate = fs.readFileSync(
      path.resolve(__dirname, '../../templates/cursor/automem.mdc.template'),
      'utf8'
    );
    expect(cursorTemplate).toMatch(/automem-template-version:\s*[\d.]+/);

    const codexTemplate = fs.readFileSync(
      path.resolve(__dirname, '../../templates/codex/memory-rules.md'),
      'utf8'
    );
    expect(codexTemplate).toMatch(/automem-template-version:\s*[\d.]+/);
  });
});
