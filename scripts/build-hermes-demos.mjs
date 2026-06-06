#!/usr/bin/env node
// Regenerates the "AutoMem inside Hermes" documentation visuals:
//   screenshots/hermes-injected-context.png — the per-turn <memory-context>
//       recall block AutoMem injects (normally invisible in the terminal).
//   screenshots/hermes-live-session.gif — a live `hermes -z` turn whose answer
//       cites a fact that exists ONLY in the seeded demo dataset, proving recall.
//
// Captured against an ISOLATED, freshly-seeded synthetic stack (Project Nimbus),
// never the personal corpus. The repo is public; first-turn recall queries
// tags=["preference"], which would otherwise surface real preferences.
//
// Safety (the load-bearing part): this swaps ~/.hermes/.env to the demo endpoint
// for the capture window, because Hermes' env_loader loads ~/.hermes/.env with
// override=True and clobbers shell/CLI env. The swap is restored on ANY exit —
// success, thrown error, or SIGINT/SIGTERM (Ctrl-C on the hanging paid turn) —
// via a single run-once cleanup() that restores .env FIRST.
//
// Run: npm run docs:hermes        (KEEP_STACK=1 to keep a stack we started)

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, execSync } from 'node:child_process';
import { tmpdir, homedir } from 'node:os';

import {
  DEMO_TAG,
  MEMORIES,
  EXPECTED_COUNT,
  DEMO_ENDPOINT,
  DEMO_API_TOKEN,
  PROVABLE_FACT,
  DEBUG_RECALL_PROMPT,
  LIVE_SESSION_PROMPT,
} from './demo/hermes-demo-data.mjs';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCREENSHOTS = join(REPO_ROOT, 'screenshots');
const TAPES = join(REPO_ROOT, 'docs', 'demos');
const OVERRIDE = join(REPO_ROOT, 'scripts', 'demo', 'hermes-demo-stack.override.yml');
const SEED_SCRIPT = join(REPO_ROOT, 'scripts', 'demo', 'seed-hermes-demo.mjs');

const HERMES_BIN = process.env.HERMES_BIN || join(homedir(), '.local', 'bin', 'hermes');
const HERMES_ENV = join(homedir(), '.hermes', '.env');
const ENV_BACKUP = join(homedir(), '.hermes', '.env.automem-demo-bak');
const AUTOMEM_REPO = process.env.AUTOMEM_REPO || join(REPO_ROOT, '..', 'automem');
const PROJECT = 'automem-hermes-demo';

const BUILD_DIR = join(tmpdir(), 'automem-hermes-demo-build');
const WORKDIR = join(BUILD_DIR, DEMO_TAG); // basename MUST be `hermes-demo` (task-context gate)

// Personal-corpus tripwires. None of these can appear in correct demo output;
// if one does, the endpoint swap failed and we're reading the real corpus.
const PERSONAL_MARKERS = ['johngarturo@gmail.com', 'jack arturo', 'streamdeck'];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const normalize = (s) => s.replace(/\s+/g, ' ').trim().toLowerCase();

// ── crash-safe cleanup ──────────────────────────────────────────────────────
// Restore ~/.hermes/.env FIRST (the thing a stranded run would leave pointing at
// demo), teardown SECOND. Run-once so the signal handlers and the finally path
// can all call it without double-acting.
let cleanedUp = false;
let envSwapped = false; // a backup exists and .env currently points at demo
let weStartedStack = false;

function cleanup() {
  if (cleanedUp) return;
  cleanedUp = true;
  if (envSwapped) {
    try {
      renameSync(ENV_BACKUP, HERMES_ENV); // same dir → atomic; overwrites swapped copy
      console.log('✓ restored ~/.hermes/.env');
    } catch (err) {
      console.error(
        `✗ FAILED to restore ~/.hermes/.env (${err.message}).\n` +
          `  Recover manually:  mv "${ENV_BACKUP}" "${HERMES_ENV}"`,
      );
    }
    envSwapped = false;
  }
  if (weStartedStack && !process.env.KEEP_STACK) {
    console.log('Tearing down the demo stack we started…');
    try {
      execSync(`docker compose -p ${PROJECT} down -v`, { stdio: 'inherit' });
    } catch {
      /* best effort */
    }
  }
}

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    console.error(`\n[${sig}] cleaning up…`);
    cleanup();
    process.exit(sig === 'SIGINT' ? 130 : 143);
  });
}
process.on('uncaughtException', (err) => {
  console.error(err);
  cleanup();
  process.exit(1);
});

// ── helpers ─────────────────────────────────────────────────────────────────
function need(cond, message) {
  if (!cond) throw new Error(message);
}

async function fetchDemo(path) {
  const res = await fetch(`${DEMO_ENDPOINT}${path}`, {
    headers: { Authorization: `Bearer ${DEMO_API_TOKEN}` },
  });
  if (!res.ok) throw new Error(`GET ${path} → ${res.status} ${res.statusText}`);
  return res.json();
}

async function ensureStackUp() {
  try {
    const h = await fetchDemo('/health');
    if (h.status === 'healthy') {
      console.log('✓ demo stack already healthy (reusing it)');
      return;
    }
  } catch {
    /* not up yet */
  }
  const compose = join(AUTOMEM_REPO, 'docker-compose.yml');
  need(
    existsSync(compose),
    `Demo stack is not running and the automem repo was not found at ${AUTOMEM_REPO}.\n` +
      '  Set AUTOMEM_REPO=/path/to/automem, or start the stack manually first.',
  );
  console.log('Bringing up the isolated demo stack…');
  weStartedStack = true;
  execSync(
    `docker compose -p ${PROJECT} -f "${compose}" -f "${OVERRIDE}" ` +
      `--project-directory "${AUTOMEM_REPO}" up -d`,
    { stdio: 'inherit' },
  );
  for (let i = 0; i < 60; i += 1) {
    try {
      const h = await fetchDemo('/health');
      if (h.status === 'healthy') {
        console.log('✓ demo stack healthy');
        return;
      }
    } catch {
      /* still starting */
    }
    await sleep(2000);
  }
  throw new Error('Demo stack did not become healthy within 120s');
}

function seed() {
  console.log('\nSeeding the synthetic demo dataset…');
  execFileSync('node', [SEED_SCRIPT], {
    cwd: REPO_ROOT,
    env: { ...process.env, AUTOMEM_API_URL: DEMO_ENDPOINT, AUTOMEM_API_KEY: DEMO_API_TOKEN },
    stdio: 'inherit',
  });
}

async function assertCleanCount() {
  const h = await fetchDemo('/health');
  need(
    h.memory_count === EXPECTED_COUNT,
    `Cleanliness gate: health.memory_count=${h.memory_count}, expected ${EXPECTED_COUNT}. ` +
      'The stack is not isolated/clean — refusing to capture.',
  );
  const byTag = await fetchDemo(
    `/memory/by-tag?tags=${encodeURIComponent(DEMO_TAG)}&limit=200`,
  );
  const list = byTag.memories || byTag.results || [];
  need(
    list.length === EXPECTED_COUNT,
    `Cleanliness gate: by-tag count=${list.length}, expected ${EXPECTED_COUNT}.`,
  );
  console.log(`✓ clean dataset: ${EXPECTED_COUNT} memories (health == by-tag)`);
}

function swapEnv() {
  need(
    !existsSync(ENV_BACKUP),
    `Stale env backup at ${ENV_BACKUP} — a previous run crashed mid-swap.\n` +
      `  Restore it FIRST:  mv "${ENV_BACKUP}" "${HERMES_ENV}"\n` +
      '  then re-run this script.',
  );
  need(existsSync(HERMES_ENV), `Hermes env not found at ${HERMES_ENV}; is Hermes installed?`);

  copyFileSync(HERMES_ENV, ENV_BACKUP);
  envSwapped = true; // from here on, cleanup() must restore

  const original = readFileSync(HERMES_ENV, 'utf8');
  let next = setEnvLine(original, 'AUTOMEM_API_URL', DEMO_ENDPOINT);
  next = setEnvLine(next, 'AUTOMEM_API_KEY', DEMO_API_TOKEN);
  // A stray AUTOMEM_ENDPOINT (deprecated alias) would still win the fallback — neutralize it.
  next = next.replace(/^AUTOMEM_ENDPOINT=.*$/m, `AUTOMEM_ENDPOINT=${DEMO_ENDPOINT}`);
  writeFileSync(HERMES_ENV, next);

  // Sanity: confirm the swap took before spending any (paid) turn.
  const status = execFileSync(HERMES_BIN, ['automem', 'status'], {
    cwd: WORKDIR,
    encoding: 'utf8',
  });
  need(
    status.includes('127.0.0.1:8051'),
    `Env swap did not take — hermes status does not show the demo endpoint:\n${status}`,
  );
  console.log('✓ ~/.hermes/.env swapped to the demo endpoint (will be restored on exit)');
}

function setEnvLine(content, key, value) {
  const re = new RegExp(`^${key}=.*$`, 'm');
  if (re.test(content)) return content.replace(re, `${key}=${value}`);
  return `${content.replace(/\n*$/, '')}\n${key}=${value}\n`;
}

// Privacy allowlist (advisor #5): every memory bullet in the block must match a
// known demo memory by normalized substring (the block appends " [tags]" and may
// reflow, so exact-line equality would false-fail). A bullet that matches nothing
// means foreign (personal) content leaked in → hard fail.
function assertOnlyDemoContent(block, label) {
  const known = MEMORIES.map((m) => normalize(m.content));
  const bullets = block
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('- '))
    .map((l) => l.slice(2));
  need(bullets.length > 0, `${label}: no memory bullets found in the block`);
  for (const bullet of bullets) {
    const content = normalize(bullet.replace(/\s*\[[^\]]*\]\s*$/, ''));
    const ok = known.some((k) => k.includes(content) || content.includes(k));
    need(
      ok,
      `Privacy gate FAILED (${label}): a block bullet is not in the demo dataset:\n  "${bullet}"`,
    );
  }
  return bullets.length;
}

function assertNoPersonalMarkers(text, label) {
  const hay = text.toLowerCase();
  for (const marker of PERSONAL_MARKERS) {
    need(
      !hay.includes(marker),
      `Privacy gate FAILED (${label}): personal-corpus marker "${marker}" present in output.`,
    );
  }
}

function runVhs(templateName, replacements) {
  let tape = readFileSync(join(TAPES, templateName), 'utf8');
  for (const [token, value] of Object.entries(replacements)) {
    tape = tape.split(`{{${token}}}`).join(value);
  }
  const realized = join(BUILD_DIR, templateName.replace(/\.tape$/, '.realized.tape'));
  writeFileSync(realized, tape);
  execFileSync('vhs', [realized], { cwd: WORKDIR, stdio: 'inherit' });
}

// ── pipeline ────────────────────────────────────────────────────────────────
async function main() {
  for (const tape of ['hermes-injected-context.tape', 'hermes-live-session.tape']) {
    need(existsSync(join(TAPES, tape)), `Missing tape template: ${join(TAPES, tape)}`);
  }
  need(existsSync(HERMES_BIN), `hermes not found at ${HERMES_BIN} (set HERMES_BIN)`);
  try {
    execFileSync('vhs', ['--version'], { stdio: 'ignore' });
  } catch {
    throw new Error('vhs not found on PATH — install Charm VHS (brew install vhs)');
  }

  rmSync(BUILD_DIR, { recursive: true, force: true });
  mkdirSync(WORKDIR, { recursive: true });
  mkdirSync(SCREENSHOTS, { recursive: true });

  await ensureStackUp();
  seed();
  await assertCleanCount();

  swapEnv();

  // ── Capture A: injected <memory-context> block (free, deterministic) ──
  console.log('\n── Capture A: injected memory-context block ──');
  const sidecarA = execFileSync(
    HERMES_BIN,
    ['automem', 'debug-recall', DEBUG_RECALL_PROMPT],
    { cwd: WORKDIR, encoding: 'utf8' },
  );
  need(sidecarA.includes('<memory-context>'), 'Capture A: no <memory-context> fence in output');
  need(sidecarA.includes('Preferences:'), 'Capture A: Preferences section missing');
  need(
    sidecarA.includes(PROVABLE_FACT.token),
    `Capture A: seeded fact "${PROVABLE_FACT.token}" missing from the block`,
  );
  assertNoPersonalMarkers(sidecarA, 'Capture A');
  const bullets = assertOnlyDemoContent(sidecarA, 'Capture A');
  writeFileSync(join(BUILD_DIR, 'injected-context.txt'), sidecarA);
  console.log(`✓ Capture A sidecar verified (${bullets} demo bullets, fact ${PROVABLE_FACT.token} present)`);

  const pngOut = join(SCREENSHOTS, 'hermes-injected-context.png');
  runVhs('hermes-injected-context.tape', {
    WORKDIR,
    PROMPT: DEBUG_RECALL_PROMPT,
    OUTPUT_GIF: join(BUILD_DIR, '_discard-a.gif'),
    OUTPUT_PNG: pngOut,
  });
  need(existsSync(pngOut), `Capture A: VHS did not produce ${pngOut}`);
  console.log(`✓ wrote ${pngOut}`);

  // ── Capture B: live one-shot turn (paid; ~$0.01) ──
  console.log('\n── Capture B: live `hermes -z` turn ──');
  const sidecarB = execFileSync(HERMES_BIN, ['-z', LIVE_SESSION_PROMPT], {
    cwd: WORKDIR,
    encoding: 'utf8',
  });
  need(
    sidecarB.includes(PROVABLE_FACT.token),
    `Capture B: live answer does not cite the seeded fact "${PROVABLE_FACT.token}" — ` +
      'recall did not fire (or the model bluffed). Refusing to ship an unfalsifiable demo.\n' +
      `  answer was: ${sidecarB.trim().slice(0, 200)}`,
  );
  assertNoPersonalMarkers(sidecarB, 'Capture B');
  writeFileSync(join(BUILD_DIR, 'live-session.txt'), sidecarB);
  console.log(`✓ Capture B sidecar verified (answer cites ${PROVABLE_FACT.token})`);

  const gifOut = join(SCREENSHOTS, 'hermes-live-session.gif');
  runVhs('hermes-live-session.tape', {
    WORKDIR,
    PROMPT: LIVE_SESSION_PROMPT,
    WAIT_TOKEN: PROVABLE_FACT.token,
    OUTPUT_GIF: gifOut,
  });
  need(existsSync(gifOut), `Capture B: VHS did not produce ${gifOut}`);
  console.log(`✓ wrote ${gifOut}`);

  console.log('\n✓ Hermes demo visuals regenerated:');
  console.log(`    ${pngOut}`);
  console.log(`    ${gifOut}`);
  console.log(`  sidecars (uncommitted): ${BUILD_DIR}`);
  if (weStartedStack && !process.env.KEEP_STACK) {
    console.log('  (the demo stack will be torn down on exit; KEEP_STACK=1 to keep it)');
  }
}

try {
  await main();
} catch (err) {
  console.error(`\n✗ ${err.message}`);
  process.exitCode = 1;
} finally {
  cleanup();
}
