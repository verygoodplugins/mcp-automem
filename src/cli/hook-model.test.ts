import path from 'path';
import { describe, expect, it } from 'vitest';
import {
  COPILOT_HOOK_EVENT_NAMES,
  COPILOT_PAYLOAD_FIELD_MAPPINGS,
  COPILOT_SESSION_END_COMMAND_ORDER,
  resolveCopilotHome,
  resolveCopilotHookSurfaces,
} from './hook-model.js';

describe('shared hook model', () => {
  it('models event names per surface', () => {
    expect(COPILOT_HOOK_EVENT_NAMES['copilot-cli'].sessionStart).toBe('sessionStart');
    expect(COPILOT_HOOK_EVENT_NAMES['vscode-copilot'].sessionStart).toBe('SessionStart');
  });

  it('models the session-end command order once', () => {
    expect(COPILOT_SESSION_END_COMMAND_ORDER).toEqual([
      'session-memory',
      'queue-cleanup',
      'queue-drain',
    ]);
  });

  it('models payload aliases used by shell hook scripts', () => {
    expect(COPILOT_PAYLOAD_FIELD_MAPPINGS.command).toContain('toolArgs.command');
    expect(COPILOT_PAYLOAD_FIELD_MAPPINGS.command).toContain('tool_input.command');
    expect(COPILOT_PAYLOAD_FIELD_MAPPINGS.exitCode).toContain('toolResult.exitCode');
    expect(COPILOT_PAYLOAD_FIELD_MAPPINGS.exitCode).toContain('tool_response.exit_code');
  });

  it('resolves COPILOT_HOME before falling back to ~/.copilot', () => {
    const home = path.join('/tmp', 'home');
    const copilotHome = path.join('/tmp', 'custom-copilot');

    expect(resolveCopilotHome({ COPILOT_HOME: copilotHome }, home)).toBe(copilotHome);
    expect(resolveCopilotHome({}, home)).toBe(path.join(home, '.copilot'));
  });

  it('resolves hook surfaces from install format', () => {
    expect(resolveCopilotHookSurfaces('cli')).toEqual(['copilot-cli']);
    expect(resolveCopilotHookSurfaces('both')).toEqual(['copilot-cli', 'vscode-copilot']);
    expect(resolveCopilotHookSurfaces('vscode')).toEqual(['vscode-copilot']);
  });
});
