// Exercises the real interactive local installer with a fake Docker/Git/Claude
// CLI, isolated HOME and a mock API. It never starts or changes real containers.
// Run after `npm run build`: node tests/e2e/local-guided-install.mjs
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMock } from './mock-automem.mjs';

const dist = fileURLToPath(new URL('../../dist/index.js', import.meta.url));
const helper = fileURLToPath(
  new URL(
    `../../node_modules/node-pty/prebuilds/${process.platform}-${process.arch}/spawn-helper`,
    import.meta.url
  )
);
if (fs.existsSync(helper)) fs.chmodSync(helper, 0o755);
const { spawn } = await import('node-pty');
const strip = (s) =>
  s
    .replace(/\x1B](?:[^\x07\x1B]|\x1B(?!\\))*(?:\x07|\x1B\\)/g, '')
    .replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, '');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const TOKEN = 'isolated-test-token';

function fakeExecutables(home, existing) {
  const bin = path.join(home, 'bin');
  fs.mkdirSync(bin, { recursive: true });
  const write = (name, source) =>
    fs.writeFileSync(path.join(bin, name), `#!/bin/sh\n${source}\n`, { mode: 0o755 });
  write(
    'docker',
    `
case "$1" in
  --version) exit 0 ;;
  info) test -f "$FAKE_DOCKER_READY" ; exit $? ;;
  ps)
    if [ "$FAKE_EXISTING" = 1 ] && { [ "$3" = "expose=8001" ] || [ "$3" = "publish=$FAKE_API_PORT" ]; }; then echo fake-api; fi
    exit 0 ;;
  inspect) cat "$FAKE_INSPECT"; exit 0 ;;
  compose)
    echo "docker $*" >> "$FAKE_LOG"
    printf '%s %s %s %s %s\\n' "$FALKORDB_HOST_PORT" "$FALKORDB_BROWSER_HOST_PORT" "$QDRANT_HOST_PORT" "$QDRANT_GRPC_HOST_PORT" "$AUTOMEM_API_HOST_PORT" > "$FAKE_PORTS"
    touch "$FAKE_COMPOSE_STARTED"; exit 0 ;;
esac
exit 1`
  );
  write('open', 'touch "$FAKE_DOCKER_READY"; echo open >> "$FAKE_LOG"');
  write('systemctl', 'touch "$FAKE_DOCKER_READY"; echo systemctl >> "$FAKE_LOG"');
  write(
    'git',
    `
[ "$1" = --version ] && exit 0
if [ "$1" = clone ]; then mkdir -p "$3/.git"; echo "git clone" >> "$FAKE_LOG"; exit 0; fi
[ "$1" = -C ] && shift 2
case "$1 $2" in
  'remote get-url') echo https://github.com/verygoodplugins/automem.git ;;
  'rev-parse HEAD') echo aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa ;;
  'rev-parse --abbrev-ref') echo origin/develop ;;
  'describe --tags') echo v0.16.2 ;;
  'symbolic-ref --quiet') echo develop ;;
  'ls-remote --heads')
    if [ "$FAKE_CHANGED" = 1 ]; then echo bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb; else echo aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa; fi ;;
  'merge-base --is-ancestor') exit 1 ;;
  'status --porcelain') exit 0 ;;
  'pull --ff-only') echo 'git pull --ff-only' >> "$FAKE_LOG" ;;
  *) exit 1 ;;
esac
exit 0`
  );
  write(
    'claude',
    `
[ "$1" = --version ] && exit 0
printf 'claude %s\\n' "$*" >> "$FAKE_LOG"
exit 0`
  );
  return bin;
}

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}
async function holdPort() {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return server;
}

async function scenario(kind) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'automem-local-e2e-'));
  const home = path.join(root, 'home'),
    cwd = path.join(root, 'project');
  fs.mkdirSync(home);
  fs.mkdirSync(cwd);
  const dir = path.join(home, 'running-server');
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, 'docker-compose.yml'), 'services: {}\n');
  const existing = kind !== 'conflict';
  let apiMock;
  const blockers = [];
  const bin = fakeExecutables(home, existing);
  const log = path.join(root, 'calls.log');
  const ready = path.join(root, 'docker-ready');
  const composeStarted = path.join(root, 'compose-started');
  const inspect = path.join(root, 'inspect.json');
  const portFile = path.join(root, 'ports');
  if (kind !== 'start' && kind !== 'decline') fs.writeFileSync(ready, '');
  let apiPort;
  let chosenApi;
  let chosenQdrant;
  const reservedPorts = new Set();
  const uniquePort = async () => {
    let port;
    do port = await freePort();
    while (reservedPorts.has(port));
    reservedPorts.add(port);
    return port;
  };
  if (existing) {
    apiMock = await createMock({ expectToken: TOKEN });
    apiPort = apiMock.port;
    fs.writeFileSync(
      inspect,
      JSON.stringify({
        Config: {
          Env: [`AUTOMEM_API_TOKEN=${TOKEN}`, 'ADMIN_API_TOKEN=admin-test'],
          Labels: {
            'com.docker.compose.service': 'flask-api',
            'com.docker.compose.project': 'automem-original',
            'com.docker.compose.project.working_dir': dir,
            'com.docker.compose.project.config_files': path.join(dir, 'docker-compose.yml'),
          },
        },
        NetworkSettings: {
          Ports: { '8001/tcp': [{ HostIp: '127.0.0.1', HostPort: String(apiPort) }] },
        },
        Mounts: [{ Type: 'bind', Source: dir, Destination: '/app' }],
      })
    );
  } else {
    blockers.push(await holdPort(), await holdPort());
    blockers.forEach((server) => reservedPorts.add(server.address().port));
    apiPort = blockers[1].address().port;
    chosenApi = await uniquePort();
    chosenQdrant = await uniquePort();
  }
  const env = {
    PATH: `${bin}${path.delimiter}${process.env.PATH}`,
    HOME: home,
    TMPDIR: os.tmpdir(),
    NO_COLOR: '1',
    AUTOMEM_NO_ANIM: '1',
    CI: '1',
    FAKE_LOG: log,
    FAKE_DOCKER_READY: ready,
    FAKE_EXISTING: existing ? '1' : '0',
    FAKE_INSPECT: inspect,
    FAKE_CHANGED: kind === 'update' || kind === 'skip-update' ? '1' : '0',
    FAKE_COMPOSE_STARTED: composeStarted,
    FAKE_PORTS: portFile,
    FAKE_API_PORT: String(apiPort),
    AUTOMEM_API_HOST_PORT: String(apiPort),
  };
  if (!existing) {
    env.FALKORDB_HOST_PORT = String(await uniquePort());
    env.FALKORDB_BROWSER_HOST_PORT = String(await uniquePort());
    env.QDRANT_HOST_PORT = String(blockers[0].address().port);
    env.QDRANT_GRPC_HOST_PORT = String(await uniquePort());
  }
  const args = [dist, 'install', '--target', 'local', '--local-dir', path.join(home, 'new-server')];
  if (kind === 'start') args.push('--clients', 'claude-code', '--claude-code-mode', 'plugin');
  else args.push('--no-agent-install');
  const term = spawn(process.execPath, args, {
    name: 'xterm-color',
    cols: 140,
    rows: 48,
    cwd,
    env,
  });
  let output = '',
    exitCode;
  term.onData((data) => {
    output += data;
    if (process.argv.includes('--watch')) process.stdout.write(data);
  });
  const exited = new Promise((resolve) =>
    term.onExit(({ exitCode: code }) => {
      exitCode = code;
      resolve();
    })
  );
  async function waitFor(pattern, timeout = 15_000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      if (pattern.test(strip(output))) return;
      if (exitCode !== undefined) throw new Error(`Process exited ${exitCode} before ${pattern}`);
      await sleep(50);
    }
    throw new Error(`Timed out waiting for ${pattern}`);
  }
  async function answer(pattern, value) {
    await waitFor(pattern);
    await sleep(150);
    term.write(value);
  }
  try {
    if (kind === 'start') await answer(/Would you like me to start Docker/, '\r');
    if (kind === 'decline') {
      await answer(/Would you like me to start Docker/, 'n\r');
      await exited;
      assert.equal(exitCode, 1);
      assert.doesNotMatch(
        fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : '',
        /open|systemctl|docker compose/
      );
      assert.equal(fs.existsSync(path.join(cwd, '.env')), false);
      console.log('local guided install (decline) … pass');
      return;
    }
    await answer(/Local AutoMem server directory/, '\r');
    if (kind === 'update') await answer(/An update is available/, 'y\r');
    if (kind === 'skip-update') await answer(/An update is available/, 'n\r');
    if (kind === 'conflict') {
      await answer(/Host port for Qdrant HTTP/, `${chosenQdrant}\r`);
      await answer(/Host port for AutoMem API/, `${chosenApi}\r`);
    }
    await answer(/Apply this AutoMem install plan/, 'y\r');
    if (kind === 'conflict') {
      const end = Date.now() + 10_000;
      while (!fs.existsSync(composeStarted) && Date.now() < end) await sleep(50);
      assert.ok(fs.existsSync(composeStarted), 'new Compose stack was started');
      const dotenv = fs.readFileSync(path.join(home, 'new-server', '.env'), 'utf8');
      const token = dotenv.match(/^AUTOMEM_API_TOKEN=(.+)$/m)?.[1];
      assert.ok(token, 'new server token persisted');
      apiMock = await createMock({ port: chosenApi, expectToken: token });
    }
    let timer;
    await Promise.race([
      exited,
      new Promise((resolve) => {
        timer = setTimeout(resolve, 25_000);
      }),
    ]);
    clearTimeout(timer);
    // Claude's plugin CLI cannot accept a secret safely in argv, so an
    // authenticated plugin install reports its existing manual key step (exit 1).
    assert.equal(exitCode, kind === 'start' ? 1 : 0, `unexpected installer exit (${exitCode})`);
    const out = strip(output);
    const calls = fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : '';
    const projectEnv = fs.readFileSync(path.join(cwd, '.env'), 'utf8');
    assert.match(
      projectEnv,
      new RegExp(`AUTOMEM_API_URL=http://127\\.0\\.0\\.1:${existing ? apiPort : chosenApi}`)
    );
    assert.ok(apiMock.requests.some((request) => request.path === '/recall' && request.authed));
    assert.ok(!out.includes(TOKEN), 'secret not displayed');
    if (kind === 'start') {
      assert.match(calls, /open|systemctl/);
      assert.match(calls, /claude plugin install/);
      assert.match(out, /plugin needs API key configuration/);
      assert.doesNotMatch(calls, /docker compose|git clone/);
      assert.match(projectEnv, new RegExp(`AUTOMEM_API_KEY=${TOKEN}`));
    } else if (kind === 'update') {
      assert.match(calls, /git pull --ff-only/);
      assert.match(calls, /docker compose -p automem-original .*up -d --no-deps --build flask-api/);
      assert.doesNotMatch(calls, /docker compose .*down|git clone/);
    } else if (kind === 'skip-update') {
      assert.doesNotMatch(calls, /git pull|docker compose|git clone/);
      assert.match(out, /Using the running AutoMem server/);
    } else {
      const ports = fs.readFileSync(portFile, 'utf8').trim().split(' ');
      assert.equal(ports[2], String(chosenQdrant));
      assert.equal(ports[4], String(chosenApi));
      assert.match(out, /Qdrant HTTP port .*already in use/);
      assert.match(out, /AutoMem API port .*already in use/);
    }
    console.log(`local guided install (${kind}) … pass`);
  } catch (error) {
    console.error(
      `local guided install (${kind}) … FAIL: ${error.message}\n${strip(output).slice(-5000)}`
    );
    throw error;
  } finally {
    try {
      term.kill();
    } catch {
      /* already exited */
    }
    if (apiMock) await apiMock.close();
    for (const server of blockers) await new Promise((resolve) => server.close(resolve));
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function preview() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'automem-local-preview-'));
  try {
    const home = path.join(root, 'home');
    fs.mkdirSync(home);
    const bin = fakeExecutables(home, false);
    const log = path.join(root, 'calls.log');
    const output = execFileSync(
      process.execPath,
      [
        dist,
        'install',
        '--target',
        'local',
        '--local-dir',
        path.join(home, 'server'),
        '--dry-run',
        '--no-agent-install',
      ],
      {
        cwd: root,
        encoding: 'utf8',
        env: {
          HOME: home,
          PATH: `${bin}${path.delimiter}${process.env.PATH}`,
          TMPDIR: os.tmpdir(),
          NO_COLOR: '1',
          AUTOMEM_NO_ANIM: '1',
          AUTOMEM_API_HOST_PORT: '18111',
          QDRANT_HOST_PORT: '16444',
          FAKE_LOG: log,
          FAKE_DOCKER_READY: path.join(root, 'not-running'),
        },
      }
    );
    assert.match(output, /http:\/\/127\.0\.0\.1:18111/);
    assert.match(output, /Qdrant HTTP: 16444/);
    assert.equal(fs.existsSync(log), false);
    assert.equal(fs.existsSync(path.join(root, '.env')), false);
    console.log('local guided install (preview) … pass');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

preview();
for (const kind of ['start', 'decline', 'update', 'skip-update', 'conflict']) await scenario(kind);
