import { makeTheme } from './theme.js';

export type TaskSpinner = {
  stop(finalLine?: string): void;
  update(text: string): void;
  error(message: string): void;
};

const FRAMES_UNICODE = ['◐', '◓', '◑', '◒'];
const FRAMES_ASCII = ['-', '\\', '|', '/'];

// Tiny dependency-free spinner (gold). On a non-TTY it degrades to a single
// printed line so piped/CI output stays clean and deterministic.
export function startSpinner(
  initial: string,
  stream: NodeJS.WriteStream = process.stdout
): TaskSpinner {
  const theme = makeTheme(stream);
  let message = initial;

  if (stream.isTTY !== true) {
    stream.write(`${theme.style.dim(theme.symbol.arrow)} ${initial}\n`);
    return {
      update: (text) => {
        message = text;
      },
      stop: (finalLine) =>
        stream.write(`${theme.style.gold(theme.symbol.check)} ${finalLine ?? message}\n`),
      error: (m) => stream.write(`${theme.style.red(theme.symbol.cross)} ${m}\n`),
    };
  }

  // ASCII frames when unicode is off so the spinner doesn't render as mojibake.
  const frames = theme.unicode ? FRAMES_UNICODE : FRAMES_ASCII;
  let frame = 0;
  stream.write('\x1b[?25l'); // hide cursor
  const render = () => {
    frame = (frame + 1) % frames.length;
    stream.write(`\r${theme.style.gold(frames[frame])} ${message}\x1b[K`);
  };
  const timer = setInterval(render, 80);
  render();

  const end = (mark: string, finalMessage: string) => {
    clearInterval(timer);
    stream.write(`\r${mark} ${finalMessage}\x1b[K\n\x1b[?25h`); // restore cursor
  };

  return {
    update: (text) => {
      message = text;
    },
    stop: (finalLine) => end(theme.style.gold(theme.symbol.check), finalLine ?? message),
    error: (m) => end(theme.style.red(theme.symbol.cross), m),
  };
}
