// Shared synthetic dataset for the "AutoMem inside Hermes" documentation demos.
//
// This module is the single source of truth consumed by:
//   - scripts/demo/seed-hermes-demo.mjs   (POSTs these memories to a demo stack)
//   - scripts/build-hermes-demos.mjs       (count gate + provable-recall assertion)
//
// Everything here is FABRICATED. "Project Nimbus" does not exist; the
// distinctive port number is invented. That is the point: the live-session
// answer is only possible if AutoMem recall actually fired, because none of
// these facts live in the model's priors or in general knowledge.
//
// Privacy invariant: the repo is public. NEVER seed the personal corpus and
// NEVER add anything here that is not obviously synthetic demo content.

// The hard-gate tag every demo memory carries. The Hermes provider derives the
// task-context recall gate from basename(cwd) (templates/hermes/provider:107),
// so the capture must run from a directory literally named `hermes-demo`.
export const DEMO_TAG = 'hermes-demo';

// Isolated demo stack coordinates — the single source of truth for the seed
// script and the build orchestrator. These MUST stay in sync with the ports and
// AUTOMEM_API_TOKEN in scripts/demo/hermes-demo-stack.override.yml. The default
// :8001 (personal) and :8011 (sandbox smoke-test) stacks are deliberately
// avoided so a stray run never touches a live instance.
export const DEMO_ENDPOINT = 'http://127.0.0.1:8051';
export const DEMO_API_TOKEN = 'hermes-demo-token';

// The load-bearing provable-recall fact. The live `hermes -z` answer is only a
// pass if `token` appears in stdout — proving recall surfaced the seeded memory
// rather than the model bluffing about a fictional project.
export const PROVABLE_FACT = {
  // The fabricated value that must appear verbatim in the live-session answer.
  token: '7341',
  // Source memory (must exist in MEMORIES below, tagged DEMO_TAG).
  sourceContent:
    'Project Nimbus staging API listens on port 7341; production listens on port 8080.',
};

// Prompt for the injected-context PNG (debug-recall). Broad + substantive so it
// triggers first-substantive recall (Preferences + Task context sections).
export const DEBUG_RECALL_PROMPT =
  'What do you remember about my preferences and Project Nimbus?';

// Prompt for the live `hermes -z` GIF. Narrow + answerable ONLY from the seeded
// port memory, so the captured answer must cite PROVABLE_FACT.token.
export const LIVE_SESSION_PROMPT =
  'What port does the Project Nimbus staging API listen on?';

// ~9 synthetic memories: 3 preferences (also DEMO_TAG so the cleanliness
// enumeration counts them), 4 project/task, 2 bugfix/solution. The Preferences
// section gates on the `preference` tag; everything else surfaces through the
// `hermes-demo` task-context gate.
export const MEMORIES = [
  {
    content:
      'Prefer concise, high-signal terminal output — skip preamble and do not restate the question.',
    tags: ['preference', DEMO_TAG],
    importance: 0.7,
  },
  {
    content:
      'Use TypeScript in strict mode for all new Project Nimbus services; never reach for `any`.',
    tags: ['preference', DEMO_TAG],
    importance: 0.7,
  },
  {
    content:
      'Deploy Project Nimbus by pushing to the connected pipeline — never hand-upload build artifacts.',
    tags: ['preference', DEMO_TAG],
    importance: 0.7,
  },
  {
    content: PROVABLE_FACT.sourceContent,
    tags: [DEMO_TAG, 'nimbus', 'infrastructure'],
    importance: 0.85,
  },
  {
    content:
      'Project Nimbus is a weather-data aggregation service for regional airports across the Pacific Northwest.',
    tags: [DEMO_TAG, 'nimbus'],
    importance: 0.6,
  },
  {
    content:
      'Project Nimbus stores its graph in FalkorDB and its embeddings in Qdrant.',
    tags: [DEMO_TAG, 'nimbus', 'architecture'],
    importance: 0.6,
  },
  {
    content:
      'The Project Nimbus on-call rotation hands off every Monday at 09:00 UTC in the #nimbus-ops channel.',
    tags: [DEMO_TAG, 'nimbus', 'ops'],
    importance: 0.55,
  },
  {
    content:
      'Fixed Project Nimbus staging 502s by raising the gateway timeout from 30s to 60s.',
    tags: [DEMO_TAG, 'nimbus', 'bugfix', 'solution'],
    importance: 0.6,
  },
  {
    content:
      'Project Nimbus ingestion stalls were traced to a missing index on station_id; adding it restored throughput.',
    tags: [DEMO_TAG, 'nimbus', 'bugfix', 'solution'],
    importance: 0.6,
  },
];

// The cleanliness invariant target: a clean stack must hold exactly this many
// Memory nodes after seeding (health.memory_count === by-tag count === this).
export const EXPECTED_COUNT = MEMORIES.length;
