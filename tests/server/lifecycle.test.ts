/**
 * Server-lifecycle tests.
 *
 * Root cause (empirically verified — see plan):
 *   1. CLEAN DISCONNECT (stdin EOF): when a client exits and the stdin
 *      write-end closes, Node drains the event loop and the server exits on
 *      its own (~125ms). The `stdin closes` test below is a regression guard
 *      for that already-working path.
 *   2. ORPHAN (the actual leak): an intermediate wrapper (npx/npm/node bin)
 *      keeps the server's stdin write-end open, so the leaf never sees EOF.
 *      When the wrapper's own parent dies, the leaf is reparented (PPID==1)
 *      and sits in the event loop forever — ~108 MB each, 155 leaked → ~18 GB.
 *      Nothing in stdin/transport/signals catches this; only the
 *      parent-liveness watchdog (Layer 4) does. The `orphaned ... watchdog`
 *      test below reproduces exactly this and FAILS until the watchdog ships.
 *
 * Both spawn the built server, so rebuild (`npm run build`) after editing src.
 */

import { describe, it, expect, afterEach, beforeAll } from 'vitest';
import { spawn, type ChildProcess } from 'child_process';
import fs from 'fs';
import path from 'path';

const SERVER_PATH = path.resolve(__dirname, '../../dist/index.js');

function waitForReady(child: ChildProcess, timeoutMs = 5000): Promise<void> {
  return new Promise((resolve, reject) => {
    let buf = '';
    const timer = setTimeout(() => {
      reject(new Error(`server did not become ready within ${timeoutMs}ms; stderr:\n${buf}`));
    }, timeoutMs);
    child.stderr?.on('data', (d: Buffer) => {
      buf += d.toString();
      if (buf.includes('AutoMem MCP server running')) {
        clearTimeout(timer);
        resolve();
      }
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`server exited before becoming ready (code ${code})`));
    });
  });
}

function waitForExit(
  child: ChildProcess,
  timeoutMs: number
): Promise<{ exited: boolean; code: number | null }> {
  return new Promise((resolve) => {
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      resolve({ exited: false, code: null });
    }, timeoutMs);
    child.on('exit', (code) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({ exited: true, code });
    });
  });
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code !== 'ESRCH';
  }
}

async function waitForPidGone(pid: number, timeoutMs: number): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (!isAlive(pid)) return true;
    await new Promise((r) => setTimeout(r, 150));
  }
  return !isAlive(pid);
}

// Wrapper that mirrors the npx/npm leaf. The crucial detail: the server's
// stdin comes from a DETACHED `sleep` (the holder), NOT from a pipe the
// wrapper or test owns. So when the wrapper is killed, the server is orphaned
// but its stdin write-end is still held by the (surviving) sleeper — no EOF
// ever arrives. If stdin instead came from a wrapper/test-owned pipe, Node
// would auto-close that pipe on wrapper exit and the server would self-heal
// via plain EOF, masking the leak. The sleeper is the production invariant:
// "parent dead, stdin still open."
const WRAPPER_SRC = `
const { spawn } = require('child_process');
const sleeper = spawn('sleep', ['600'], { stdio: ['ignore', 'pipe', 'ignore'], detached: true });
sleeper.unref();
const server = spawn(process.execPath, [process.argv[1]], { stdio: [sleeper.stdout, 'inherit', 'inherit'] });
process.stdout.write('SLEEPER_PID=' + sleeper.pid + '\\n');
process.stdout.write('SERVER_PID=' + server.pid + '\\n');
setInterval(() => {}, 1 << 30);
`;

interface OrphanPids {
  serverPid: number;
  sleeperPid: number;
}

function waitForServerPidAndReady(
  wrapper: ChildProcess,
  timeoutMs: number
): Promise<OrphanPids> {
  return new Promise((resolve, reject) => {
    let out = '';
    let err = '';
    let serverPid: number | undefined;
    let sleeperPid: number | undefined;
    const timer = setTimeout(() => {
      reject(
        new Error(
          `wrapper did not produce a ready server within ${timeoutMs}ms\n` +
            `stdout:\n${out}\nstderr:\n${err}`
        )
      );
    }, timeoutMs);
    const tryResolve = () => {
      if (
        serverPid !== undefined &&
        sleeperPid !== undefined &&
        err.includes('AutoMem MCP server running')
      ) {
        clearTimeout(timer);
        resolve({ serverPid, sleeperPid });
      }
    };
    wrapper.stdout?.on('data', (d: Buffer) => {
      out += d.toString();
      const sm = out.match(/SERVER_PID=(\d+)/);
      if (sm) serverPid = Number(sm[1]);
      const lm = out.match(/SLEEPER_PID=(\d+)/);
      if (lm) sleeperPid = Number(lm[1]);
      tryResolve();
    });
    wrapper.stderr?.on('data', (d: Buffer) => {
      err += d.toString();
      tryResolve();
    });
    wrapper.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`wrapper exited before server was ready (code ${code})`));
    });
  });
}

// These reproductions spawn a detached `sleep 600` to hold stdin open and
// exercise the parent-liveness watchdog, which relies on POSIX orphan
// reparenting. Neither exists on Windows (no `sleep`, no reparenting), so the
// suite is skipped on win32 — see the POSIX-only note in src/lifecycle.ts.
describe.skipIf(process.platform === 'win32')('MCP server lifecycle', () => {
  let child: ChildProcess | undefined;
  let leafPid: number | undefined;
  let holderPid: number | undefined;

  beforeAll(() => {
    if (!fs.existsSync(SERVER_PATH)) {
      throw new Error(`Server not built. Run 'npm run build' first. Expected: ${SERVER_PATH}`);
    }
  });

  afterEach(() => {
    if (child && child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL');
    }
    child = undefined;
    // Neither the orphaned leaf nor its detached stdin-holder is our direct
    // child; reap both explicitly so they never leak past the test.
    for (const pid of [leafPid, holderPid]) {
      if (pid !== undefined && isAlive(pid)) {
        try {
          process.kill(pid, 'SIGKILL');
        } catch {
          /* already gone */
        }
      }
    }
    leafPid = undefined;
    holderPid = undefined;
  });

  it(
    'self-terminates within 3s when stdin closes (client disconnect)',
    async () => {
      child = spawn(process.execPath, [SERVER_PATH], {
        env: {
          ...process.env,
          AUTOMEM_API_URL: 'http://localhost:9999',
          AUTOMEM_LOG_LEVEL: 'debug',
        },
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      await waitForReady(child);

      // Simulate the client going away: close the write-end of the server's
      // stdin so it receives EOF, exactly as a disconnecting MCP client would.
      child.stdin?.end();

      const result = await waitForExit(child, 3000);
      expect(result.exited).toBe(true);
    },
    15000
  );

  it(
    'orphaned leaf self-terminates via parent-liveness watchdog',
    async () => {
      // Spawn the wrapper (the `node -e` WRAPPER_SRC above). It starts a
      // DETACHED `sleep 600` and wires the sleeper's stdout to the server as
      // stdin, then spawns the server as its own child. When we SIGKILL the
      // wrapper, the server is orphaned (reparented to PID 1) but its stdin
      // write-end is still held by the surviving detached sleeper — so no EOF
      // ever arrives. That is the production leak; only the watchdog escapes
      // it. (Routing stdin through a wrapper/test-owned pipe instead would let
      // Node close it on the wrapper's death and the server self-heal via EOF,
      // masking the leak — that was the earlier spurious-pass trap.)
      child = spawn(process.execPath, ['-e', WRAPPER_SRC, SERVER_PATH], {
        env: {
          ...process.env,
          AUTOMEM_API_URL: 'http://localhost:9999',
          AUTOMEM_LOG_LEVEL: 'debug',
          // Tick fast so the test doesn't wait the 30s production default.
          AUTOMEM_PARENT_WATCHDOG_MS: '250',
        },
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      const pids = await waitForServerPidAndReady(child, 8000);
      leafPid = pids.serverPid;
      holderPid = pids.sleeperPid;
      expect(isAlive(leafPid)).toBe(true);

      // Kill the wrapper (plain SIGKILL). The leaf is now PPID==1 with stdin
      // held open by the surviving detached sleeper — the orphan condition.
      child.kill('SIGKILL');

      // Watchdog ticks at 250ms; allow generous margin for reparent + reap.
      const gone = await waitForPidGone(leafPid, 8000);
      expect(gone).toBe(true);
    },
    20000
  );
});
