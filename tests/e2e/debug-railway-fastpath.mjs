// Fully-CLI/API Railway provision PROTOTYPE — the "fast path" (no browser deploy).
//
// Proves the path we discovered after `railway deploy -t` turned out to fire its
// deploy mutation fine but then 401 on its own post-deploy workflow poll (a false
// negative). We skip that poll entirely: fire Railway's GraphQL templateDeployV2
// ourselves (exactly what the browser "Deploy Now" and the railway MCP do), then
// gate readiness on AutoMem's own /health — which is what the installer trusts anyway.
//
// Sequence (only `login` is ever interactive — unavoidable for a brand-new account):
//   1. railway whoami --json        → refresh + read the CLI session token
//   2. railway init --name <n>      → create + link a project (CLI)
//   3. railway status --json        → read projectId + environmentId
//   4. GraphQL template(code)       → templateId + serializedConfig          [public read]
//   5. GraphQL templateDeployV2     → workflowId                              [BILLABLE]
//   6. poll railway domain --json   → the template-generated public domain
//   7. poll <endpoint>/health       → AutoMem's own readiness gate
//   8. railway variable list --json → AUTOMEM_API_KEY (fallback AUTOMEM_API_TOKEN)
//
// Build first (parsers come from dist/):  npm run build
// Run:
//   node tests/e2e/debug-railway-fastpath.mjs              # full path incl. a real deploy (asks first)
//   node tests/e2e/debug-railway-fastpath.mjs --name foo   # project name (default: automem-fastpath-test)
//   node tests/e2e/debug-railway-fastpath.mjs --service x  # public-API service name (default: automem)
//   node tests/e2e/debug-railway-fastpath.mjs --yes        # don't prompt before the billable deploy
//   node tests/e2e/debug-railway-fastpath.mjs --show-secrets
//
// On failure it stops with a FAILED banner and prints the `railway delete` cleanup line.

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const DIST = path.resolve(fileURLToPath(new URL('../../dist/cli/cloud/railway.js', import.meta.url)));
if (!existsSync(DIST)) {
  console.error(`FATAL: ${DIST} missing — run \`npm run build\` first.`);
  process.exit(2);
}
const { parseDomain, parseVariable } = await import(DIST);

const ENDPOINT = 'https://backboard.railway.com/graphql/v2';
const TEMPLATE_CODE = 'automem-ai-memory-service';
const TOKEN_VARS = ['AUTOMEM_API_KEY', 'AUTOMEM_API_TOKEN'];
const CONFIG = path.join(homedir(), '.railway', 'config.json');

const argv = process.argv.slice(2);
const hasFlag = (f) => argv.includes(f);
const flagVal = (f, d) => {
  const i = argv.indexOf(f);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
};
const OPT = {
  name: flagVal('--name', 'automem-fastpath-test'),
  service: flagVal('--service', 'automem'),
  yes: hasFlag('--yes'),
  showSecrets: hasFlag('--show-secrets'),
  domainTimeoutMs: 120000,
  healthTimeoutMs: 300000,
};

// --- pretty ------------------------------------------------------------------
const C = process.stdout.isTTY
  ? { gold: '\x1b[38;5;179m', dim: '\x1b[2m', red: '\x1b[31m', green: '\x1b[32m', bold: '\x1b[1m', reset: '\x1b[0m' }
  : { gold: '', dim: '', red: '', green: '', bold: '', reset: '' };
let step = 0;
let createdProjectId; // for the cleanup hint
const banner = (t) => process.stdout.write(`\n${C.gold}${C.bold}━━━ STEP ${(step += 1)} · ${t} ━━━${C.reset}\n`);
const note = (m) => process.stdout.write(`${C.dim}  ${m}${C.reset}\n`);
const ok = (m) => process.stdout.write(`${C.green}  ✓ ${m}${C.reset}\n`);
const redact = (v) => (typeof v === 'string' && v.length > 8 ? `${v.slice(0, 3)}…${v.slice(-3)}` : '***');

function cleanupHint() {
  if (createdProjectId) {
    process.stdout.write(
      `${C.dim}  cleanup: railway delete -p ${createdProjectId}   (or delete "${OPT.name}" in the dashboard)${C.reset}\n`
    );
  }
}
function fail(label, detail) {
  process.stdout.write(`\n${C.red}${C.bold}╳ FAILED AT STEP ${step} · ${label}${C.reset}\n${C.red}  ${detail}${C.reset}\n`);
  cleanupHint();
  process.exit(1);
}
const ask = (q) =>
  new Promise((r) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(`${C.gold}${q}${C.reset} `, (a) => {
      rl.close();
      r(a.trim());
    });
  });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- railway CLI -------------------------------------------------------------
function runInteractive(args) {
  process.stdout.write(`${C.dim}$ railway ${args.join(' ')}${C.reset}\n`);
  const r = spawnSync('railway', args, { stdio: 'inherit' });
  if (r.error) fail(`railway ${args[0]}`, `CLI not runnable: ${r.error.message}`);
  const code = r.status ?? 1;
  note(`exit: ${code}`);
  return { code };
}
function runCaptured(args, { quiet = false } = {}) {
  if (!quiet) process.stdout.write(`${C.dim}$ railway ${args.join(' ')}${C.reset}\n`);
  const r = spawnSync('railway', args, { encoding: 'utf8' });
  if (r.error) fail(`railway ${args[0]}`, `CLI not runnable: ${r.error.message}`);
  return { code: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

// --- GraphQL -----------------------------------------------------------------
function readAccessToken() {
  // Re-read each time so we pick up the token `railway whoami` may have refreshed.
  const cfg = JSON.parse(readFileSync(CONFIG, 'utf8'));
  return cfg?.user?.accessToken;
}
async function gql(query, variables, { auth }) {
  const headers = { 'Content-Type': 'application/json' };
  if (auth) headers.Authorization = `Bearer ${readAccessToken()}`;
  const res = await fetch(ENDPOINT, { method: 'POST', headers, body: JSON.stringify({ query, variables }) });
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    return { status: res.status, errors: [{ message: `non-JSON: ${text.slice(0, 200)}` }] };
  }
  return { status: res.status, data: body.data, errors: body.errors };
}

// --- flow --------------------------------------------------------------------
process.stdout.write(
  `${C.bold}Railway fast-path (CLI init + GraphQL deploy) prototype${C.reset}\n` +
    `${C.dim}name=${OPT.name} service=${OPT.service} secrets=${OPT.showSecrets ? 'shown' : 'masked'}${C.reset}\n`
);

// 1. Auth — whoami refreshes + validates the session; read workspace for a non-interactive init.
banner('Auth — whoami --json');
let who = runCaptured(['whoami', '--json']);
if (who.code !== 0 || !who.stdout.trim()) {
  note('Not signed in — running interactive `railway login` (browser; also creates an account if new).');
  runInteractive(['login']);
  who = runCaptured(['whoami', '--json']);
  if (who.code !== 0) fail('whoami', 'Still not signed in after login.');
}
let workspaceId;
try {
  workspaceId = JSON.parse(who.stdout)?.workspaces?.[0]?.id;
} catch {
  /* ignore */
}
if (!readAccessToken()) fail('whoami', `No user.accessToken in ${CONFIG}.`);
ok(`Authenticated${workspaceId ? ` (workspace ${workspaceId})` : ''}.`);

// 2. Create + link a project (CLI). --workspace keeps it non-interactive when known.
banner(`Create + link project — init --name ${OPT.name}`);
if (!OPT.yes) {
  const a = await ask(`This creates a project and then triggers a REAL, billable deploy. Continue? [y/N]`);
  if (a.toLowerCase() !== 'y' && a.toLowerCase() !== 'yes') {
    note('Aborted before any project/deploy.');
    process.exit(0);
  }
}
const initArgs = ['init', '--name', OPT.name, '--json'];
if (workspaceId) initArgs.push('--workspace', workspaceId);
const inited = runCaptured(initArgs);
if (inited.stdout.trim()) note(`stdout: ${inited.stdout.trim()}`);
if (inited.stderr.trim()) note(`stderr: ${inited.stderr.trim()}`);
if (inited.code !== 0) fail('init', `railway init exited ${inited.code}.`);
ok('Project created + linked.');

// 3. Read projectId + environmentId from status.
banner('Read project context — status --json');
const status = runCaptured(['status', '--json']);
if (status.code !== 0) fail('status', status.stderr.trim() || `exit ${status.code}`);
let projectId;
let environmentId;
try {
  const s = JSON.parse(status.stdout);
  projectId = s.id;
  createdProjectId = projectId;
  const envs = (s.environments?.edges ?? []).map((e) => e.node).filter(Boolean);
  environmentId = (envs.find((n) => n.name === 'production') ?? envs[0])?.id;
} catch (e) {
  fail('status', `Could not parse status JSON: ${e.message}`);
}
if (!projectId || !environmentId) fail('status', `Missing projectId/environmentId (project=${projectId} env=${environmentId}).`);
ok(`project=${projectId}  environment=${environmentId}`);

// 4. Fetch the template's id + serializedConfig (public).
banner(`Fetch template config — GraphQL template(code:"${TEMPLATE_CODE}")`);
const tmpl = await gql(
  'query TemplateDetail($code:String!){ template(code:$code){ id name serializedConfig } }',
  { code: TEMPLATE_CODE },
  { auth: false }
);
if (tmpl.errors || !tmpl.data?.template?.id) {
  fail('template', `GraphQL ${tmpl.status}: ${JSON.stringify(tmpl.errors ?? tmpl.data)}`);
}
const templateId = tmpl.data.template.id;
const serializedConfig = tmpl.data.template.serializedConfig;
const svcCount = serializedConfig?.services ? Object.keys(serializedConfig.services).length : '?';
ok(`templateId=${templateId}  (serializedConfig: ${svcCount} services)`);

// 5. Deploy via GraphQL templateDeployV2 — the step the CLI does but then mis-polls.
banner('Deploy template — GraphQL templateDeployV2  [BILLABLE]');
const deploy = await gql(
  `mutation TemplateDeploy($projectId:String!,$environmentId:String!,$templateId:String!,$serializedConfig:SerializedTemplateConfig!){
     templateDeployV2(input:{projectId:$projectId,environmentId:$environmentId,templateId:$templateId,serializedConfig:$serializedConfig}){ projectId workflowId }
   }`,
  { projectId, environmentId, templateId, serializedConfig },
  { auth: true }
);
if (deploy.errors || !deploy.data?.templateDeployV2?.workflowId) {
  fail('templateDeployV2', `GraphQL ${deploy.status}: ${JSON.stringify(deploy.errors ?? deploy.data)}`);
}
ok(`deploy accepted — workflowId=${deploy.data.templateDeployV2.workflowId}`);
note('Skipping Railway\'s workflow poll (the step that false-negatives). Gating on the domain + /health instead.');

// 6. Poll for the template-generated public domain (never generate one).
banner(`Wait for public domain — domain --service ${OPT.service} --json`);
let domain;
const domStart = Date.now();
while (Date.now() - domStart < OPT.domainTimeoutMs) {
  const r = runCaptured(['domain', '--service', OPT.service, '--json'], { quiet: true });
  domain = parseDomain(r.stdout);
  if (domain) break;
  process.stdout.write(`${C.dim}  …no domain yet (${Math.round((Date.now() - domStart) / 1000)}s)${C.reset}\r`);
  await sleep(5000);
}
if (!domain) fail(`domain --service ${OPT.service}`, `No domain after ${OPT.domainTimeoutMs / 1000}s (wrong --service name?).`);
const endpoint = /^https?:\/\//i.test(domain) ? domain : `https://${domain}`;
ok(`endpoint: ${endpoint}`);

// 7. Gate on AutoMem's own /health (the installer's authoritative readiness check).
banner(`Wait for readiness — GET ${endpoint}/health`);
let healthy = false;
const hStart = Date.now();
while (Date.now() - hStart < OPT.healthTimeoutMs) {
  try {
    const res = await fetch(`${endpoint}/health`, { signal: AbortSignal.timeout(8000) });
    if (res.status === 200) {
      healthy = true;
      break;
    }
    process.stdout.write(`${C.dim}  …health ${res.status} (${Math.round((Date.now() - hStart) / 1000)}s)${C.reset}\r`);
  } catch (e) {
    process.stdout.write(`${C.dim}  …building (${Math.round((Date.now() - hStart) / 1000)}s: ${e.name})${C.reset}\r`);
  }
  await sleep(5000);
}
if (!healthy) fail('/health', `Endpoint not healthy after ${OPT.healthTimeoutMs / 1000}s: ${endpoint}/health`);
ok('Endpoint healthy.');

// 8. Read the API token variable.
banner(`Read API token — variable list --service ${OPT.service} --json`);
const vars = runCaptured(['variable', 'list', '--service', OPT.service, '--json'], { quiet: true });
if (vars.code !== 0) fail(`variable list --service ${OPT.service}`, vars.stderr.trim() || `exit ${vars.code}`);
let token;
let tokenVar;
for (const name of TOKEN_VARS) {
  token = parseVariable(vars.stdout, name);
  if (token) {
    tokenVar = name;
    break;
  }
}
if (!token) fail(`variable list --service ${OPT.service}`, `Neither ${TOKEN_VARS.join(' nor ')} found.`);
ok(`token from ${tokenVar}: ${OPT.showSecrets ? token : redact(token)}`);

// Summary.
process.stdout.write(
  `\n${C.green}${C.bold}✓ FAST PATH SUCCEEDED (no browser deploy)${C.reset}\n` +
    `${C.green}  AUTOMEM_API_URL = ${endpoint}${C.reset}\n` +
    `${C.green}  AUTOMEM_API_KEY = ${OPT.showSecrets ? token : redact(token)}  (from ${tokenVar})${C.reset}\n`
);
cleanupHint();
