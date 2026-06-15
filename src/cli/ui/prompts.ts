// Gold-themed interactive prompts built on @inquirer/prompts. clack's accent is
// a hardcoded green with no theme hook, so we use inquirer (the Node equivalent
// of Railway's `inquire`) and drive its theme from our shared palette — which
// keeps NO_COLOR / non-TTY behavior consistent with the rest of the UI.
import { checkbox, confirm, input, select } from '@inquirer/prompts';
import { ExitPromptError } from '@inquirer/core';
import { makeTheme } from './theme.js';

export type PromptOption<T> = {
  value: T;
  label: string;
  hint?: string;
};

function goldTheme(stream: NodeJS.WriteStream = process.stdout) {
  const t = makeTheme(stream);
  return {
    prefix: { idle: t.style.gold('◆'), done: t.style.gold(t.symbol.check) },
    spinner: {
      interval: 80,
      frames: ['◐', '◓', '◑', '◒'].map((f) => t.style.gold(f)),
    },
    style: {
      answer: (s: string) => t.style.gold(s),
      message: (s: string) => t.style.bold(s),
      highlight: (s: string) => t.style.gold(s),
      help: (s: string) => t.style.dim(s),
      error: (s: string) => t.style.red(s),
      defaultAnswer: (s: string) => t.style.dim(s),
      key: (s: string) => t.style.gold(s),
      description: (s: string) => t.style.dim(s),
    },
    icon: {
      cursor: t.style.gold(t.symbol.arrow),
      checked: t.style.gold(t.symbol.check),
      unchecked: t.style.dim(t.symbol.bullet),
    },
  };
}

// inquirer rejects with ExitPromptError on Ctrl-C. Mirror clack's cancel(): print
// a terse line and exit cleanly so a cancel is never an error stack trace.
export async function cancelable<T>(promise: Promise<T>): Promise<T> {
  try {
    return await promise;
  } catch (err) {
    if (err instanceof ExitPromptError) {
      const t = makeTheme(process.stdout);
      process.stdout.write(`\n${t.style.dim('AutoMem install canceled.')}\n`);
      process.exit(0);
    }
    throw err;
  }
}

export function promptSelect<T>(opts: {
  message: string;
  options: PromptOption<T>[];
  initialValue?: T;
}): Promise<T> {
  return select<T>({
    message: opts.message,
    choices: opts.options.map((o) => ({ name: o.label, value: o.value, description: o.hint })),
    default: opts.initialValue,
    theme: goldTheme(),
  });
}

export function promptText(opts: {
  message: string;
  defaultValue?: string;
  validate?: (value: string) => boolean | string;
}): Promise<string> {
  return input({
    message: opts.message,
    default: opts.defaultValue,
    validate: opts.validate,
    theme: goldTheme(),
  });
}

export function promptMultiselect<T>(opts: {
  message: string;
  options: PromptOption<T>[];
  initialValues?: T[];
  required?: boolean;
}): Promise<T[]> {
  return checkbox<T>({
    message: opts.message,
    choices: opts.options.map((o) => ({
      name: o.label,
      value: o.value,
      description: o.hint,
      checked: opts.initialValues?.includes(o.value) ?? false,
    })),
    required: opts.required,
    theme: goldTheme(),
  });
}

export function promptConfirm(opts: { message: string; initialValue?: boolean }): Promise<boolean> {
  return confirm({ message: opts.message, default: opts.initialValue, theme: goldTheme() });
}
