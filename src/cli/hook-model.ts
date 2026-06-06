import path from 'path';
import os from 'os';

export type CopilotInstallFormat = 'cli' | 'vscode' | 'both';
export type CopilotHookSurface = 'copilot-cli' | 'vscode-copilot';
export type HookSurface = 'claude-code' | CopilotHookSurface;

export const COPILOT_HOOK_EVENT_NAMES = {
  'copilot-cli': {
    sessionStart: 'sessionStart',
    postToolUse: 'postToolUse',
    sessionEnd: 'sessionEnd',
  },
  'vscode-copilot': {
    sessionStart: 'SessionStart',
    postToolUse: 'PostToolUse',
    sessionEnd: 'SessionEnd',
  },
} as const;

export const COPILOT_SESSION_END_COMMAND_ORDER = [
  'session-memory',
  'queue-cleanup',
  'queue-drain',
] as const;

export const COPILOT_PAYLOAD_FIELD_MAPPINGS = {
  command: [
    'toolArgs.command',
    'toolInput.command',
    'tool_args.command',
    'tool_input.command',
  ],
  output: [
    'toolResult.textResultForLlm',
    'toolResult.output',
    'tool_result.text_result_for_llm',
    'tool_response.textResultForLlm',
    'tool_response.output',
    'toolResponse.textResultForLlm',
    'toolResponse.output',
    'tool_response',
    'toolResult',
  ],
  exitCode: [
    'toolResult.exitCode',
    'toolResult.exit_code',
    'tool_result.exit_code',
    'tool_response.exitCode',
    'tool_response.exit_code',
    'toolResponse.exitCode',
    'toolResponse.exit_code',
  ],
} as const;

export function resolveCopilotHome(
  env: NodeJS.ProcessEnv = process.env,
  homeDir = os.homedir()
): string {
  const configured = env.COPILOT_HOME?.trim();
  return configured || path.join(homeDir, '.copilot');
}

export function resolveCopilotHookSurfaces(format: CopilotInstallFormat): CopilotHookSurface[] {
  if (format === 'cli') {
    return ['copilot-cli'];
  }
  if (format === 'vscode') {
    return ['vscode-copilot'];
  }
  return ['copilot-cli', 'vscode-copilot'];
}
