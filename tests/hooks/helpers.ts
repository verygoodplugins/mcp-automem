/**
 * Helpers for driving the template hook scripts in isolation.
 *
 * Hooks read a JSON payload on stdin (Claude Code's hook input format) and
 * either print injected context (session-start, stop-nudge) or write a /tmp
 * sentinel (track-store). Tests run them with an isolated TMPDIR/HOME so the
 * real user state is untouched.
 */

import path from 'path';

export const HOOKS_DIR = path.resolve(__dirname, '../../templates/claude-code/hooks');
