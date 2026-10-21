import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { AUTOMEM_IMPORTANCE_GUIDANCE } from './memory-policy/shared.js';

const read = (file: string) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');

describe('shipped memory policy consistency', () => {
  const rules = [
    'templates/codex/memory-rules.md',
    'templates/cursor/automem.mdc.template',
    'templates/cursor/user-rules.md',
    'templates/CLAUDE_DESKTOP_INSTRUCTIONS.md',
    'templates/CLAUDE_MD_MEMORY_RULES.md',
    'templates/hermes/memory-rules.md',
    'templates/grok/memory-rules.md',
    'templates/openclaw/skill-mcp/SKILL.md',
    'templates/COPILOT_INSTRUCTIONS_MEMORY_RULES.md',
    'templates/copilot/automem.instructions.md',
    'plugins/automem/skills/memory-management/SKILL.md',
    'plugins/automem/skills/memory-management/patterns.md',
    'plugins/automem/commands/memory-store.md',
    'plugins/automem/README.md',
  ];

  it.each(rules)('%s forbids platform and date tags', (file) => {
    const text = read(file);
    expect(text).toMatch(/(?:no|do not (?:add|use)|avoid)[^\n.]*platform tags/i);
    expect(text).toMatch(/(?:no|do not (?:add|use)|avoid)[^\n.]*date[- ](?:stamped )?tags/i);
  });

  it.each([
    'plugins/automem/skills/memory-management/SKILL.md',
    'plugins/automem/commands/memory-store.md',
    'plugins/automem/README.md',
    'templates/CLAUDE_CODE_INTEGRATION.md',
  ])('%s agrees with correction, bugfix and pattern importance', (file) => {
    const text = read(file);
    expect(text).toContain(AUTOMEM_IMPORTANCE_GUIDANCE);
    expect(text).toContain('Bug fixes: Insight, importance 0.75, confidence 0.85.');
    expect(text).toContain('Articulated patterns: Pattern, importance 0.8.');
    expect(text).toContain('User corrections: Preference, importance 0.9, confidence 0.95.');
    expect(text).not.toMatch(/\|\s*\*?\*?Insight\*?\*?\s*\|\s*0\.8\s*\|/);
    expect(text).not.toMatch(/\|\s*\*?\*?Pattern\*?\*?\s*\|\s*0\.7\s*\|/);
  });

  it.each([
    ['Insight', 0.75],
    ['Pattern', 0.8],
    ['Preference', 0.9],
  ])('plugin companion examples use %s importance %s', (type, expectedImportance) => {
    const text = read('plugins/automem/skills/memory-management/patterns.md');
    const examples = [...text.matchAll(/```javascript\s*([\s\S]*?)```/g)].map((match) =>
      match[1].trim()
    );
    const typedExamples = examples.filter((example) =>
      new RegExp(`type:\\s*["']${type}["']`).test(example)
    );
    expect(typedExamples).not.toHaveLength(0);
    for (const example of typedExamples) {
      const importance = example.match(/importance:\s*([0-9.]+)/);
      expect(importance, example).not.toBeNull();
      expect(Number(importance![1])).toBe(expectedImportance);
      if (type === 'Preference') expect(example).toContain('"correction"');
    }
  });

  it('Hermes captures source in metadata without adding a platform tag', () => {
    const provider = fileURLToPath(
      new URL('../templates/hermes/provider/__init__.py', import.meta.url)
    );
    const captured = JSON.parse(
      execFileSync(
        'python3',
        [
          '-c',
          `
import importlib.util, json, pathlib, sys, types
sys.dont_write_bytecode = True
memory = types.ModuleType('agent.memory_provider')
memory.MemoryProvider = object
sys.modules['agent.memory_provider'] = memory
registry = types.ModuleType('tools.registry')
registry.tool_error = lambda message: message
sys.modules['tools.registry'] = registry
sys.path.insert(0, str(pathlib.Path(sys.argv[1]).parent))
spec = importlib.util.spec_from_file_location('automem_capture_test', sys.argv[1])
module = importlib.util.module_from_spec(spec)
module.__package__ = ""
spec.loader.exec_module(module)
captured = []
class Client:
    def store(self, payload): captured.append(payload)
provider = module.AutoMemMemoryProvider()
provider._active = provider._auto_capture = True
provider._client = Client()
provider.sync_turn('A durable user message with sufficient length', 'A durable assistant response with sufficient length', session_id='capture-test')
provider.shutdown()
print(json.dumps(captured))
`,
          provider,
        ],
        { encoding: 'utf8' }
      )
    );
    expect(captured).toHaveLength(1);
    expect(captured[0].tags).toEqual(['conversation-turn']);
    expect(captured[0].metadata).toEqual({ source: 'hermes_provider', session_id: 'capture-test' });
    expect(read('templates/hermes/memory-rules.md')).not.toContain('`hermes`');
  });
});
