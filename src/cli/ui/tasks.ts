import { spinner } from '@clack/prompts';

export type TaskSpinner = {
  stop(finalLine?: string): void;
  update(text: string): void;
  error(message: string): void;
};

export function startSpinner(
  initial: string,
  stream: NodeJS.WriteStream = process.stdout
): TaskSpinner {
  const spin = spinner({ output: stream });
  spin.start(initial);
  return {
    update: (text) => spin.message(text),
    stop: (finalLine) => spin.stop(finalLine),
    error: (message) => spin.error(message),
  };
}
