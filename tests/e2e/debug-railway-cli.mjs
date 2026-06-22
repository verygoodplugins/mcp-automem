// Verbose, step-by-step CLI-driven Railway provision EXPERIMENT.
//
// Runs the REAL `railway` CLI against your REAL Railway account so you can watch
// exactly where a fully-CLI install flow succeeds or fails. It mirrors the command
// sequence a CLI-based installer provider would use AND imports the installer's own
// parseDomain/parseVariable from dist — so a parse failure here is a parse failure
// in the real installer, not a lookalike.
//
// Unlike demo-railway.mjs (fake CLI + mock server, no account, no cost), this is the
// live thing: it can trigger a real, billable (cheap, ~$1-5/mo, deletable) deploy.
// The deploy step is gated behind an explicit y/N confirm.
//
// Build first so the parsers are current:
//   npm run build
//
// Then run:
//   node tests/e2e/debug-railway-cli.mjs                 # full flow: init → deploy -t → read (asks before deploy)
//   node tests/e2e/debug-railway-cli.mjs --no-deploy     # skip deploy: link an EXISTING project, just run the reads
//   node tests/e2e/debug-railway-cli.mjs --init-name foo  # name the new project (default: automem-cli-test)
//   node tests/e2e/debug-railway-cli.mjs --service api    # override the public-API service name (default: automem)
//   node tests/e2e/debug-railway-cli.mjs --show-secrets   # print real variable values (default: masked)
//   node tests/e2e/debug-railway-cli.mjs --yes            # don't prompt before the billable deploy
//
// Every step prints: the exact argv, raw stdout/stderr, the exit code, and (for the
// JSON reads) what the installer's parser extracts. On the first failure it prints a
// FAILED AT STEP banner and stops — calling out "Unauthorized" explicitly if it shows.

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const DIST = path.resolve(fileURLToPath(new URL('../../dist/cli/cloud/railway.js', import.meta.url)));
if (!existsSync(DIST)) {
  console.error(`FATAL: ${DIST} missing — run \`npm run build\` first.`);
  process.exit(2);
}
const { parseDomain, parseVariable } = await import(DIST);

// --- args --------------------------------------------------------------------
const argv = process.argv.slice(2);
const hasFlag = (f) => argv.includes(f);
const flagVal = (f, d) => {
  const i = argv.indexOf(f);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
};
const OPT = {
  service: flagVal('--service', 'automem'),
  template: flagVal('--template', 'automem-ai-memory-service'),
  initName: flagVal('--init-name', 'automem-cli-test'),
  noDeploy: hasFlag('--no-deploy'),
  yes: hasFlag('--yes'),
  showSecrets: hasFlag('--show-secrets'),
};
// Token var names the installer reads, in priority order (migration-proof).
const TOKEN_VARS = ['AUTOMEM_API_KEY', 'AUTOMEM_API_TOKEN'];

// --- pretty ------------------------------------------------------------------
const C = process.stdout.isTTY
  ? { gold: '\x1b[38;5;179m', dim: '\x1b[2m', red: '\x1b[31m', green: '\x1b[32m', bold: '\x1b[1m', reset: '\x1b[0m' }
  : { gold: '', dim: '', red: '', green: '', bold: '', reset: '' };
let step = 0;
const banner = (title) => {
  step += 1;
  process.stdout.write(`\n${C.gold}${C.bold}━━━ STEP ${step} · ${title} ━━━${C.reset}\n`);
};
const cmdLine = (args) => process.stdout.write(`${C.dim}$ railway ${args.join(' ')}${C.reset}\n`);
const note = (msg) => process.stdout.write(`${C.dim}  ${msg}${C.reset}\n`);
const ok = (msg) => process.stdout.write(`${C.green}  ✓ ${msg}${C.reset}\n`);

function fail(stepNo, label, detail) {
  process.stdout.write(
    `\n${C.red}${C.bold}╳ FAILED AT STEP ${stepNo} · ${label}${C.reset}\n` +
      `${C.red}  ${detail}${C.reset}\n`
  );
  if (/unauthor[iz]?[sz]ed/i.test(detail)) {
    process.stdout.write(
      `${C.red}  → This is the "Unauthorized" you hit. It happened at the ${label} step, not the deploy.${C.reset}\n`
    );
  }
  process.exit(1);
}

const ask = (question) =>
  new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(`${C.gold}${question}${C.reset} `, (a) => {
      rl.close();
      resolve(a.trim());
    });
  });

// --- runners (mirror railway.ts: interactive inherits, JSON is captured) ------
function runInteractive(args) {
  cmdLine(args);
  const r = spawnSync('railway', args, { stdio: 'inherit' });
  if (r.error) fail(step, `railway ${args[0]}`, `CLI not runnable: ${r.error.message}`);
  const code = r.status ?? 1;
  note(`exit: ${code}`);
  return { code };
}

function mask(stdout) {
  if (OPT.showSecrets) return stdout;
  try {
    const body = JSON.parse(stdout);
    const redact = (v) => (typeof v === 'string' && v.length > 8 ? `${v.slice(0, 3)}…${v.slice(-3)}` : '***');
    if (Array.isArray(body)) {
      return JSON.stringify(
        body.map((e) => (e && typeof e === 'object' && 'value' in e ? { ...e, value: redact(e.value) } : e)),
        null,
        2
      );
    }
    if (body && typeof body === 'object') {
      return JSON.stringify(
        Object.fromEntries(Object.entries(body).map(([k, v]) => [k, redact(v)])),
        null,
        2
      );
    }
    return stdout;
  } catch {
    return stdout; // non-JSON: nothing structured to mask
  }
}

function runCaptured(args, { secrets = false } = {}) {
  cmdLine(args);
  const r = spawnSync('railway', args, { encoding: 'utf8' });
  if (r.error) fail(step, `railway ${args[0]}`, `CLI not runnable: ${r.error.message}`);
  const code = r.status ?? 1;
  const stdout = r.stdout ?? '';
  const stderr = r.stderr ?? '';
  if (stdout.trim()) process.stdout.write(`${C.dim}  stdout: ${(secrets ? mask(stdout) : stdout).trim()}${C.reset}\n`);
  if (stderr.trim()) process.stdout.write(`${C.dim}  stderr: ${stderr.trim()}${C.reset}\n`);
  note(`exit: ${code}`);
  return { code, stdout, stderr };
}

// --- flow --------------------------------------------------------------------
process.stdout.write(
  `${C.bold}Railway CLI install experiment${C.reset}\n` +
    `${C.dim}service=${OPT.service} template=${OPT.template} ` +
    `mode=${OPT.noDeploy ? 'link-existing (no deploy)' : 'deploy'} ` +
    `secrets=${OPT.showSecrets ? 'shown' : 'masked'}${C.reset}\n`
);

// 1. Auth check (captured, like isSignedIn) → interactive login if needed.
banner('Auth check — whoami --json');
let who = runCaptured(['whoami', '--json']);
if (who.code !== 0 || !who.stdout.trim()) {
  note('Not signed in — running interactive `railway login` (a browser will open).');
  banner('Sign in — login');
  runInteractive(['login']);
  who = runCaptured(['whoami', '--json']);
  if (who.code !== 0 || !who.stdout.trim()) {
    fail(step, 'whoami', 'Still not signed in after login.');
  }
}
ok('Authenticated.');

// 2. Show current link context before we touch anything.
banner('Current link context — status --json');
runCaptured(['status', '--json']);

// 3. Deploy the template via CLI, or link an existing project.
if (OPT.noDeploy) {
  banner('Attach to an existing project — link');
  note('Pick the AutoMem project you already deployed; this is the "later step" suspect.');
  const linked = runInteractive(['link']);
  if (linked.code !== 0) fail(step, 'link', `railway link exited ${linked.code}.`);
  ok('Linked.');
} else {
  if (!OPT.yes) {
    const a = await ask(
      `This will create a new Railway project ("${OPT.initName}") and trigger a REAL, billable deploy (cheap, deletable). Continue? [y/N]`
    );
    if (a.toLowerCase() !== 'y' && a.toLowerCase() !== 'yes') {
      note('Skipped. Re-run with --no-deploy to test the read steps against an existing project.');
      process.exit(0);
    }
  }
  // `railway deploy -t` provisions INTO a linked project — it does not create one.
  // So create + link a fresh project first (this was the missing step).
  banner(`Create + link a new project — init --name ${OPT.initName}`);
  const inited = runInteractive(['init', '--name', OPT.initName]);
  if (inited.code !== 0) fail(step, 'init', `railway init exited ${inited.code} (pick a workspace if prompted).`);
  ok('Project created + linked.');
  banner('Confirm link — status --json');
  runCaptured(['status', '--json']);

  banner(`Deploy template via CLI — deploy -t ${OPT.template}`);
  const deployed = runInteractive(['deploy', '-t', OPT.template]);
  if (deployed.code !== 0) {
    fail(step, 'deploy', `railway deploy exited ${deployed.code} — the deploy itself failed (unexpected per your earlier run).`);
  }
  ok('Deploy command returned 0.');
  banner('Link context after deploy — status --json');
  runCaptured(['status', '--json']);
  note('Template services build asynchronously. Wait until they are green in the Railway dashboard.');
  await ask('Press Enter once the services are live, to read the domain + token…');
}

// 4. Read the domain — both without and with --service, so a wrong service name is obvious.
banner('Read domain (no --service) — domain --json');
runCaptured(['domain', '--json']);

banner(`Read domain (--service ${OPT.service}) — domain --service ${OPT.service} --json`);
const domRes = runCaptured(['domain', '--service', OPT.service, '--json']);
if (domRes.code !== 0) {
  fail(step, `domain --service ${OPT.service}`, `exit ${domRes.code}: ${domRes.stderr.trim() || 'no stderr'}`);
}
const domain = parseDomain(domRes.stdout);
if (!domain) {
  fail(step, `domain --service ${OPT.service}`, `parseDomain() found no domain in stdout (wrong --service name?).`);
}
ok(`parsed domain: ${domain}`);

// 5. Read the variables — both without and with --service — then extract the token.
banner('Read variables (no --service) — variable list --json');
runCaptured(['variable', 'list', '--json'], { secrets: true });

banner(`Read variables (--service ${OPT.service}) — variable list --service ${OPT.service} --json`);
const varsRes = runCaptured(['variable', 'list', '--service', OPT.service, '--json'], { secrets: true });
if (varsRes.code !== 0) {
  fail(step, `variable list --service ${OPT.service}`, `exit ${varsRes.code}: ${varsRes.stderr.trim() || 'no stderr'}`);
}
let token;
let tokenVar;
for (const name of TOKEN_VARS) {
  token = parseVariable(varsRes.stdout, name);
  if (token) {
    tokenVar = name;
    break;
  }
}
if (!token) {
  fail(
    step,
    `variable list --service ${OPT.service}`,
    `Neither ${TOKEN_VARS.join(' nor ')} found. Check the variable names printed above.`
  );
}
const redacted = token.length > 8 ? `${token.slice(0, 3)}…${token.slice(-3)}` : '***';
ok(`token from ${tokenVar}: ${OPT.showSecrets ? token : redacted}`);

// 6. Summary — what the installer would persist.
const endpoint = /^https?:\/\//i.test(domain) ? domain : `https://${domain}`;
process.stdout.write(
  `\n${C.green}${C.bold}✓ FULL CLI FLOW SUCCEEDED${C.reset}\n` +
    `${C.green}  AUTOMEM_API_URL = ${endpoint}${C.reset}\n` +
    `${C.green}  AUTOMEM_API_KEY = ${OPT.showSecrets ? token : redacted}  (read from ${tokenVar})${C.reset}\n` +
    `${C.dim}  → If you saw this, the fully-CLI path works and we can drop the browser hand-off.${C.reset}\n`
);
