import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { AGENT_CLIENTS, type AgentClient } from './clients.js';
import { promptSelect } from './ui/prompts.js';

/** A user-visible first message, never a hook or a hidden system instruction. */
export const WELCOME_PROMPT = `Hi! This welcome message was prepared by the AutoMem installer for me.

I'd like a short, friendly introduction to how memory works while you get to know me and how I work. I can skip a question, stop the tour, or ask you not to save something at any time.

First, check whether the AutoMem memory tools are available. If they aren't, tell me honestly and help me connect them; don't pretend that anything was saved. There may already be memories, so check instead of assuming the graph is empty.

Ask me three to five short, useful questions, one at a time, about my work, current projects, preferences, and how I like to collaborate. Adapt to what I share rather than following a rigid questionnaire. Don't ask for or store passwords, API keys, other secrets, or sensitive personal data.

As we talk, point out meaningful preferences, decisions, milestones, and corrections that may be useful later. Explain briefly why each is worth remembering and, unless I object, store useful durable details as we go. Show me the nuts and bolts: the actual memory tool name and a small, readable JSON preview of what you're sending, without secrets or unnecessary personal details. Report what actually succeeded or failed. Recall existing context before adding a duplicate, and when a real connection exists, demonstrate an association using IDs returned by the tools. Don't invent tool calls, results, or relationships.

When we wrap up, tell me what you're saving and why before saving any remaining useful memory, then verify the result. If everything useful is already saved, say so instead of duplicating it. Recap what was actually saved and how I can correct or remove it. Explain that it lives in the configured AutoMem service beyond this chat, and that another device or assistant can use it only when connected to that same reachable service. Don't promise encryption, backups, universal sync, or safety you haven't verified. End with a warm, reassuring see you later that reflects what was actually saved.`;

export type WelcomeTarget = {
  client: AgentClient;
  label: string;
  hint: string;
  method: 'cursor' | 'terminal' | 'copy';
};

const LABELS: Record<AgentClient, string> = {
  codex: 'Codex',
  'claude-code': 'Claude Code',
  cursor: 'Cursor',
  openclaw: 'OpenClaw',
  hermes: 'Hermes',
  grok: 'Grok Build',
};

const TERMINAL_COMMANDS: Partial<Record<AgentClient, string>> = {
  codex: 'codex',
  'claude-code': 'claude',
  grok: 'grok',
  openclaw: 'openclaw',
};

/** Welcome launchers do not need the installer's AutoMem credentials. */
function welcomeEnvironment(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const result = { ...env };
  for (const key of [
    'AUTOMEM_API_KEY',
    'AUTOMEM_API_TOKEN',
    'CLAUDE_PLUGIN_OPTION_API_KEY',
    'CLAUDE_PLUGIN_OPTION_api_key',
    'CLAUDE_PLUGIN_OPTION_API_TOKEN',
    'CLAUDE_PLUGIN_OPTION_api_token',
  ])
    delete result[key];
  return result;
}

type Runner = (
  command: string,
  args: string[],
  options: {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    input?: string;
    interactive?: boolean;
    timeout?: number;
  }
) => boolean;

const run: Runner = (command, args, options) => {
  try {
    const result = spawnSync(command, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      input: options.input,
      stdio: options.interactive ? 'inherit' : ['pipe', 'ignore', 'ignore'],
      timeout: options.timeout,
      windowsHide: !options.interactive,
    });
    // Leaving an interactive chat with Ctrl-C is not a failed launch and should
    // not unexpectedly replace the user's clipboard with the prompt afterward.
    return (
      result.status === 0 ||
      (Boolean(options.interactive) && (result.signal === 'SIGINT' || result.status === 130))
    );
  } catch {
    return false;
  }
};

export function welcomeTargets(params: {
  clients: AgentClient[];
  platform?: NodeJS.Platform;
  commandExists?: (command: string) => boolean;
}): WelcomeTarget[] {
  const platform = params.platform ?? process.platform;
  const exists =
    params.commandExists ??
    ((command: string) =>
      run(command, ['--version'], { timeout: 5_000, env: welcomeEnvironment(process.env) }));
  return params.clients.map((client) => {
    const command = TERMINAL_COMMANDS[client];
    // Do not run .cmd shims through a shell with a multi-line prompt on Windows.
    // The copy path still works there and does not launch a headless model call.
    const method =
      client === 'cursor'
        ? 'cursor'
        : command && platform !== 'win32' && exists(command)
          ? 'terminal'
          : 'copy';
    return {
      client,
      label:
        method === 'copy' ? `Copy the prompt for ${LABELS[client]}` : `Start in ${LABELS[client]}`,
      hint:
        method === 'cursor'
          ? 'opens a prefilled chat for you to review'
          : method === 'terminal'
            ? 'starts an interactive conversation'
            : 'paste it into your assistant',
      method,
    };
  });
}

/** A declined or interrupted welcome leaves the already-completed install alone. */
export async function promptWelcomeTarget(
  targets: WelcomeTarget[]
): Promise<AgentClient | undefined> {
  try {
    const choice = await promptSelect<AgentClient | 'skip'>({
      message: 'Start the AutoMem welcome conversation?',
      options: [
        ...targets.map((target) => ({
          value: target.client,
          label: target.label,
          hint: target.hint,
        })),
        { value: 'skip', label: 'Not now', hint: 'skip the welcome conversation' },
      ],
      initialValue: targets[0].client,
    });
    return choice === 'skip' ? undefined : choice;
  } catch (error) {
    if (error instanceof Error && error.name === 'ExitPromptError') return undefined;
    throw error;
  }
}

export function cursorWelcomeUrl(cwd: string): string {
  const url = new URL('cursor://anysphere.cursor-deeplink/prompt');
  url.searchParams.set('text', WELCOME_PROMPT);
  const workspace = path.basename(path.resolve(cwd));
  if (workspace) url.searchParams.set('workspace', workspace);
  return url.toString();
}

function openCursor(
  url: string,
  platform: NodeJS.Platform,
  runner: Runner,
  env: NodeJS.ProcessEnv
): boolean {
  if (env.AUTOMEM_NO_BROWSER) return false;
  if (platform === 'darwin') return runner('open', [url], { timeout: 8_000 });
  if (platform === 'win32')
    return runner(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        'Start-Process -FilePath $env:AUTOMEM_WELCOME_DEEPLINK',
      ],
      {
        env: { ...env, AUTOMEM_WELCOME_DEEPLINK: url },
        timeout: 8_000,
      }
    );
  return runner('xdg-open', [url], { timeout: 8_000 });
}

function copyPrompt(platform: NodeJS.Platform, runner: Runner, env: NodeJS.ProcessEnv): boolean {
  const commands: [string, string[]][] =
    platform === 'darwin'
      ? [['pbcopy', []]]
      : platform === 'win32'
        ? [['clip.exe', []]]
        : [
            ['wl-copy', []],
            ['xclip', ['-selection', 'clipboard']],
            ['xsel', ['--clipboard', '--input']],
          ];
  return commands.some(([command, args]) =>
    runner(command, args, { input: WELCOME_PROMPT, timeout: 5_000, env })
  );
}

/** Open the selected interactive host, or offer a copyable prompt when unavailable. */
export function startWelcome(params: {
  target: WelcomeTarget;
  cwd: string;
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  runCommand?: Runner;
  /** The guided Codex install uses a private file instead of inherited credentials. */
  clearCredentials?: boolean;
}): { method: 'opened' | 'finished' | 'copied' | 'printed'; message: string; prompt?: string } {
  const platform = params.platform ?? process.platform;
  const runner = params.runCommand ?? run;
  const env = params.env ?? process.env;
  const cleanEnv = welcomeEnvironment(env);
  const name = LABELS[params.target.client];
  if (
    params.target.method === 'cursor' &&
    openCursor(cursorWelcomeUrl(params.cwd), platform, runner, cleanEnv)
  ) {
    return {
      method: 'opened',
      message: 'The welcome message is ready in Cursor. Review it and press Send to begin.',
    };
  }
  if (params.target.method === 'terminal') {
    const command = TERMINAL_COMMANDS[params.target.client];
    const args =
      params.target.client === 'openclaw' ? ['tui', '--message', WELCOME_PROMPT] : [WELCOME_PROMPT];
    const launcherEnv =
      params.target.client === 'codex' && params.clearCredentials ? cleanEnv : env;
    if (
      command &&
      runner(command, args, { cwd: params.cwd, interactive: true, env: launcherEnv })
    ) {
      return { method: 'finished', message: `Welcome conversation in ${name} finished.` };
    }
  }
  if (copyPrompt(platform, runner, cleanEnv)) {
    return { method: 'copied', message: `Welcome message copied. Paste it into ${name} to begin.` };
  }
  return {
    method: 'printed',
    message: `Copy this welcome message into ${name} to begin:`,
    prompt: WELCOME_PROMPT,
  };
}

/** Reopen the tour later without re-running an installer. */
export async function runWelcomeCommand(args: string[] = []): Promise<void> {
  if (args.includes('--help') || args.includes('-h')) {
    process.stdout.write(
      'Usage: mcp-automem welcome [--client <name>] [--print]\n\nOpen the optional welcome conversation, or print the message to paste anywhere.\n'
    );
    return;
  }
  let client: AgentClient | undefined;
  let print = false;
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--print') {
      print = true;
    } else if (args[i] === '--client') {
      const value = args[++i];
      if (!(AGENT_CLIENTS as readonly string[]).includes(value)) {
        throw new Error(`Choose a welcome client: ${AGENT_CLIENTS.join(', ')}.`);
      }
      client = value as AgentClient;
    } else {
      throw new Error(`Unknown welcome option: ${args[i]}`);
    }
  }
  if (print || !process.stdin.isTTY || !process.stdout.isTTY) {
    process.stdout.write(`${WELCOME_PROMPT}\n`);
    return;
  }
  const targets = welcomeTargets({ clients: client ? [client] : [...AGENT_CLIENTS] });
  const choice = client ?? (await promptWelcomeTarget(targets));
  if (!choice) return;
  const target = targets.find((item) => item.client === choice)!;
  const result = startWelcome({ target, cwd: process.cwd() });
  process.stdout.write(`${result.message}\n${result.prompt ? `\n${result.prompt}\n` : ''}`);
}
