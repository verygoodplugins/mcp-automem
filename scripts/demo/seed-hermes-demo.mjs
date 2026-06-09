#!/usr/bin/env node
// Seeds the synthetic "Project Nimbus" dataset into an AutoMem instance so the
// Hermes documentation demos (scripts/build-hermes-demos.mjs) have stable,
// public-safe content to recall.
//
// Endpoint-agnostic: talks to whatever AUTOMEM_API_URL points at. Defaults to
// the isolated demo stack (DEMO_ENDPOINT, :8051), NOT the personal instance on
// :8001 — the repo is public and first-turn recall queries tags=["preference"],
// which would otherwise surface the real corpus. See docs in hermes-demo-data.mjs.
//
// Idempotent: bulk-deletes any existing `hermes-demo`-tagged memories first
// (DELETE /memory/by-tag), then re-seeds. Re-running keeps the cleanliness
// invariant exact (health.memory_count === by-tag count === EXPECTED_COUNT).
//
// Usage:
//   node scripts/demo/seed-hermes-demo.mjs
//   AUTOMEM_API_URL=http://127.0.0.1:8051 node scripts/demo/seed-hermes-demo.mjs
//   node scripts/demo/seed-hermes-demo.mjs --no-reset
//   node scripts/demo/seed-hermes-demo.mjs --allow-remote   (required for non-loopback)

import {
  DEMO_TAG,
  MEMORIES,
  EXPECTED_COUNT,
  DEMO_ENDPOINT,
  DEMO_API_TOKEN,
} from './hermes-demo-data.mjs';

const PERSONAL_ENDPOINT = 'http://127.0.0.1:8001';

const args = process.argv.slice(2);
const reset = !args.includes('--no-reset');
const allowRemote = args.includes('--allow-remote');

const endpoint = (
  process.env.AUTOMEM_API_URL ||
  process.env.AUTOMEM_ENDPOINT ||
  DEMO_ENDPOINT
).replace(/\/+$/, '');

// Loopback guard — the one safety net for the incident that actually fired:
// a stray AUTOMEM_ENDPOINT (e.g. the Railway prod URL) in the shell silently
// redirected the seed at a live remote instance. The repo is public and the
// demo dataset is tagged `hermes-demo`, but seeding (and the reset DELETE) must
// NEVER touch a remote host unless the operator opts in explicitly.
function isLoopbackEndpoint(urlStr) {
  let host;
  try {
    host = new URL(urlStr).hostname; // lowercased; IPv6 keeps its [brackets]
  } catch {
    return false; // unparseable → treat as non-loopback (fail safe)
  }
  host = host.replace(/^\[|\]$/g, ''); // strip IPv6 brackets → bare ::1
  return host === 'localhost' || host === '::1' || /^127\.\d+\.\d+\.\d+$/.test(host);
}

if (!isLoopbackEndpoint(endpoint) && !allowRemote) {
  console.error(
    `\n✗ Refusing to seed a non-loopback endpoint: ${endpoint}\n` +
      '  This script seeds (and resets via DELETE) demo data. The default target is\n' +
      `  the isolated demo stack at ${DEMO_ENDPOINT}. A remote URL here usually means a\n` +
      '  stray AUTOMEM_API_URL / AUTOMEM_ENDPOINT in your shell is redirecting the run.\n' +
      '  If you truly intend a remote target, re-run with --allow-remote.',
  );
  process.exit(1);
}

// The demo stack's known token is only used as a fallback when we're actually
// talking to the demo stack — never inject it into an arbitrary endpoint.
const apiKey =
  process.env.AUTOMEM_API_KEY ||
  process.env.AUTOMEM_API_TOKEN ||
  (endpoint === DEMO_ENDPOINT ? DEMO_API_TOKEN : '');

function headers() {
  const h = { 'Content-Type': 'application/json' };
  if (apiKey) h.Authorization = `Bearer ${apiKey}`;
  return h;
}

async function request(method, path, body) {
  const url = `${endpoint}/${path.replace(/^\/+/, '')}`;
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: headers(),
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (err) {
    throw new Error(`${method} ${url} failed to connect: ${err.message}`);
  }
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`${method} ${url} → ${res.status} ${res.statusText}: ${text.slice(0, 300)}`);
  }
  return text ? JSON.parse(text) : {};
}

async function main() {
  console.log(`\nSeeding Hermes demo dataset → ${endpoint}`);
  console.log(`  tag: ${DEMO_TAG}   memories: ${EXPECTED_COUNT}   api key: ${apiKey ? 'set' : 'not set'}`);
  if (endpoint === PERSONAL_ENDPOINT) {
    console.warn(
      '\n  ⚠️  Targeting the default personal AutoMem instance (:8001).\n' +
        '      Demo memories are tagged `hermes-demo` and are removed on the next reset,\n' +
        '      but the isolated demo stack (:8051) is the intended target. Continuing.',
    );
  }

  if (reset) {
    try {
      const deleted = await request('DELETE', `memory/by-tag?tags=${encodeURIComponent(DEMO_TAG)}`);
      const count = deleted?.deleted_count ?? deleted?.count ?? 0;
      console.log(`\n  reset: removed ${count} existing \`${DEMO_TAG}\` memor${count === 1 ? 'y' : 'ies'}`);
    } catch (err) {
      console.error(`\n  ✗ reset failed: ${err.message}`);
      process.exit(1);
    }
  }

  const timestamp = new Date().toISOString();
  let stored = 0;
  for (const memory of MEMORIES) {
    try {
      await request('POST', 'memory', {
        content: memory.content,
        tags: memory.tags,
        importance: memory.importance,
        timestamp,
      });
      stored += 1;
      console.log(`  ✓ ${memory.content.slice(0, 72)}${memory.content.length > 72 ? '…' : ''}`);
    } catch (err) {
      console.error(`  ✗ ${err.message}`);
    }
  }

  console.log(`\n${stored === EXPECTED_COUNT ? '✓' : '✗'} stored ${stored}/${EXPECTED_COUNT} memories`);
  if (stored !== EXPECTED_COUNT) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(`\n✗ seed failed: ${err.message}`);
  process.exit(1);
});
