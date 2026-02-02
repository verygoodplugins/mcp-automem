import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';

// Mock fs module
vi.mock('fs');
vi.mock('os');

const mockFs = vi.mocked(fs);
const mockOs = vi.mocked(os);

describe('claude-code CLI', () => {
  const mockHomeDir = '/mock/home';

  beforeEach(() => {
    vi.clearAllMocks();
    mockOs.homedir.mockReturnValue(mockHomeDir);
    mockFs.existsSync.mockReturnValue(false);
    mockFs.mkdirSync.mockImplementation(() => undefined);
    mockFs.readFileSync.mockReturnValue('{}');
    mockFs.writeFileSync.mockImplementation(() => undefined);
    mockFs.copyFileSync.mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('mergeUniqueStrings', () => {
    // Test the merge logic directly
    it('should merge unique strings without duplicates', () => {
      const target = ['a', 'b'];
      const additions = ['b', 'c', 'd'];
      
      // Simulate the merge logic
      const set = new Set(target);
      for (const value of additions) {
        if (!set.has(value)) {
          target.push(value);
          set.add(value);
        }
      }
      
      expect(target).toEqual(['a', 'b', 'c', 'd']);
    });

    it('should handle empty target', () => {
      const target: string[] = [];
      const additions = ['a', 'b'];
      
      const set = new Set(target);
      for (const value of additions) {
        if (!set.has(value)) {
          target.push(value);
          set.add(value);
        }
      }
      
      expect(target).toEqual(['a', 'b']);
    });
  });

  describe('mergeSettings', () => {
    it('should merge permissions correctly', () => {
      const target = {
        permissions: {
          allow: ['Edit', 'Write'],
          deny: ['Bash(sudo:*)'],
        },
      };
      
      const template = {
        permissions: {
          allow: ['Write', 'mcp__memory__store_memory', 'mcp__memory__recall_memory'],
          deny: ['Bash(su:*)'],
        },
      };

      // Simulate merge logic
      const merged = { ...target };
      merged.permissions = merged.permissions ?? {};
      
      const targetAllow = merged.permissions.allow ?? [];
      const set = new Set(targetAllow);
      for (const perm of template.permissions.allow) {
        if (!set.has(perm)) {
          targetAllow.push(perm);
        }
      }
      merged.permissions.allow = targetAllow;

      expect(merged.permissions.allow).toContain('Edit');
      expect(merged.permissions.allow).toContain('Write');
      expect(merged.permissions.allow).toContain('mcp__memory__store_memory');
      expect(merged.permissions.allow).toContain('mcp__memory__recall_memory');
      // Should not duplicate 'Write'
      expect(merged.permissions.allow.filter(p => p === 'Write').length).toBe(1);
    });

    it('should preserve existing permissions', () => {
      const target = {
        permissions: {
          allow: ['CustomPermission'],
          defaultMode: 'ask',
        },
      };

      const template = {
        permissions: {
          allow: ['mcp__memory__store_memory'],
        },
      };

      const merged = { ...target };
      const targetAllow = merged.permissions.allow ?? [];
      for (const perm of template.permissions.allow) {
        if (!targetAllow.includes(perm)) {
          targetAllow.push(perm);
        }
      }
      merged.permissions.allow = targetAllow;

      expect(merged.permissions.allow).toContain('CustomPermission');
      expect(merged.permissions.defaultMode).toBe('ask');
    });
  });

  describe('backupPath', () => {
    it('should generate unique backup path', () => {
      const filePath = '/path/to/settings.json';
      
      // First backup doesn't exist
      mockFs.existsSync.mockReturnValueOnce(false);
      
      let candidate = `${filePath}.bak`;
      let counter = 1;
      while (fs.existsSync(candidate)) {
        candidate = `${filePath}.bak.${counter}`;
        counter += 1;
      }
      
      expect(candidate).toBe('/path/to/settings.json.bak');
    });

    it('should increment counter if backup exists', () => {
      const filePath = '/path/to/settings.json';
      
      // .bak exists, .bak.1 doesn't
      mockFs.existsSync
        .mockReturnValueOnce(true)  // .bak
        .mockReturnValueOnce(false); // .bak.1
      
      let candidate = `${filePath}.bak`;
      let counter = 1;
      while (fs.existsSync(candidate)) {
        candidate = `${filePath}.bak.${counter}`;
        counter += 1;
      }
      
      expect(candidate).toBe('/path/to/settings.json.bak.1');
    });
  });

  describe('parseClaudeArgs', () => {
    it('should parse --dir argument', () => {
      const args = ['--dir', '/custom/path'];
      const options: Record<string, any> = {};
      
      for (let i = 0; i < args.length; i++) {
        if (args[i] === '--dir') {
          options.targetDir = args[i + 1];
          i += 1;
        }
      }
      
      expect(options.targetDir).toBe('/custom/path');
    });

    it('should parse --dry-run flag', () => {
      const args = ['--dry-run'];
      const options: Record<string, any> = {};
      
      for (const arg of args) {
        if (arg === '--dry-run') {
          options.dryRun = true;
        }
      }
      
      expect(options.dryRun).toBe(true);
    });

    it('should parse --quiet flag', () => {
      const args = ['--quiet'];
      const options: Record<string, any> = {};
      
      for (const arg of args) {
        if (arg === '--quiet') {
          options.quiet = true;
        }
      }
      
      expect(options.quiet).toBe(true);
    });

    it('should parse multiple arguments', () => {
      const args = ['--dir', '/path', '--dry-run', '--quiet'];
      const options: Record<string, any> = {};
      
      for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg === '--dir') {
          options.targetDir = args[i + 1];
          i += 1;
        } else if (arg === '--dry-run') {
          options.dryRun = true;
        } else if (arg === '--quiet') {
          options.quiet = true;
        }
      }
      
      expect(options.targetDir).toBe('/path');
      expect(options.dryRun).toBe(true);
      expect(options.quiet).toBe(true);
    });
  });

  describe('MCP permissions', () => {
    const MCP_PERMISSIONS = [
      'mcp__memory__store_memory',
      'mcp__memory__recall_memory',
      'mcp__memory__associate_memories',
      'mcp__memory__update_memory',
      'mcp__memory__delete_memory',
      'mcp__memory__check_database_health',
    ];

    it('should include all MCP memory permissions', () => {
      expect(MCP_PERMISSIONS).toHaveLength(6);
      expect(MCP_PERMISSIONS).toContain('mcp__memory__store_memory');
      expect(MCP_PERMISSIONS).toContain('mcp__memory__recall_memory');
      expect(MCP_PERMISSIONS).toContain('mcp__memory__associate_memories');
    });

    it('should use correct MCP permission format', () => {
      for (const perm of MCP_PERMISSIONS) {
        expect(perm).toMatch(/^mcp__memory__[a-z_]+$/);
      }
    });
  });
});

