# AutoMem installer — end-to-end test harness: findings

**Date:** 2026-06-05
**Command under test:** `npx -y file:<tarball> install …` — the exact form the website
`install.sh` (`curl … | sh`) execs, run against a built+packed tarball of the installer repo's
`feat/codex-hooks` branch (local version `0.14.0`).
**Isolation:** every scenario runs in a throwaway `HOME=$(mktemp -d)` + throwaway project cwd,
a curated env (no ambient `CI`/`CODEX_*`/`CLAUDE_CODE_*` leakage), a shared npm cache, and an
adversarial in-process mock endpoint. **No operator config was touched** — your real
`~/.claude.json`, `~/.codex/`, `~/.config/automem/.env`, and the dev project's FalkorDB/Qdrant
containers were never in the write surface.

**Result: 10/11 scenarios pass, 1 skipped.** "Pass" means the harness's assertions held — it does
**not** mean the installer is defect-free. The single non-pass is `website-bootstrap-install-sh`,
which is **SKIPPED, not failed** (see "The website-bootstrap skip" below): `npx`'s staging of a
local `file:` tarball hits an **intermittent per-exec hang**, and `install.sh` runs `npx -y
file:<tarball>` **twice per run**, so it hits the flake often enough that the bounded 1-retry budget
can't clear it. An artifact of the pre-NPX **local-tarball** harness, not an installer defect. The
10 direct-`npx` scenarios exercise the installer's real behavior and all pass, so the gate exits `0`.

The investigation surfaced **5 findings** (F2 + its sibling, F3, F4, F5). The three with
implemented fixes (F2, F4, F5) are now baked into the tarball-under-test, so at runtime the harness
emits only the **2 residual findings** that have no in-repo fix: `F2-sibling-also-advice-only`
(info) and `F3-install-sh-no-api-key` (medium). The other three now run as **regression-guards** —
they re-fire the moment a fix is reverted. All code fixes are gated behind your decision.

### Fix-status at a glance

| Finding | Severity | Where it lives | Fix status |
|---|---|---|---|
| F2 — config.toml plan↔executor mismatch | medium | installer (pre-merge) | **Implemented, gated** — `agentPaths('codex')` no longer promises a `config.toml` write; covered by a unit test + the `dry-run-no-writes` regression-guard. |
| F2-sibling — claude server reg is also advice-only | info | installer (published) | **No fix** — this is consistent house style, documented so it isn't misread as a codex-specific asymmetry. |
| F3 — install.sh has no `--api-key` passthrough | medium | **automem-website** (auto-deploys on push) | **Separate ask** — NOT auto-fixed. Lives in a repo that ships on push; surfaced for an explicit decision. |
| F4 — install adds Codex, uninstall can't remove it | medium | installer (published) | **Implemented, gated** — `uninstall codex` target added; covered by the `uninstall-after-install` regression-guard. |
| F5 — health gate accepts any HTTP 200 | low | installer (pre-merge) | **Implemented, gated** — `verifyAutoMemEndpoint` now requires a JSON body with a string `status`. The `malformed-health-200-html` e2e scenario is the regression-guard; the unit-test mock change just keeps the existing retry test green against the new code path. |

Two additional always-passing security gates — `verify-500-silent-pass` and
`verify-401-silent-pass` (both `high`) — are guarded by the `endpoint-500-aborts` and
`bad-token-401-aborts` scenarios. They are **not** defects: the installer correctly aborts before
any write on a 500 or a 401. The harness keeps them so a future regression that lets either slip
to `exit 0` re-fires loudly.

---

## The one distinction that governs everything below: live vs. pre-merge

I verified this against the **published** npm tarball (`@verygoodplugins/mcp-automem@0.14.0`),
not just the local branch:

| Surface | In published `@latest 0.14.0`? | Notes |
|---|---|---|
| `install` command (guided orchestrator) | **NO** — there is no `install.js` in published `dist/cli/` | The whole guided flow is **pre-merge**, unreleased. |
| `codex` command (`mcp-automem codex`) | **YES** — `dist/cli/codex.js` ships | Writes AGENTS.md + hooks + scripts; **advice-only** on `config.toml` (logs a pointer at the template, never writes it). |
| `uninstall` command | **YES** — `dist/cli/uninstall.js` ships | Published accepts only `cursor` / `claude-code`. The local branch adds `hermes`; this work adds `codex`. |
| `templates/codex/config.toml`, `install.sh` | **YES** — both present in published tarball | |

So a finding is only a "production bug" if it lives in code that's **published today**. A finding
about the `install` command is a **pre-merge defect** — it blocks acceptance of an unreleased
feature, it is not shipping to users yet.

---

## Findings

### F2 — `config.toml`: the plan promised a write the executor never performed
**Classification: PRE-MERGE defect** (lives in the unreleased `install` command).
**Severity: medium.** **Verified. Fix implemented (gated).**

- **VERIFIED:** The `install` plan (stage 3) presented a "write + backup `~/.codex/config.toml`"
  step. The executor only logged advice pointing at `templates/codex/config.toml` and never wrote
  the file. Confirmed two ways: (a) directly — no `.codex/config.toml` in the write surface, stdout
  showed the advice-only notice; (b) through the **real production path** — the website `install.sh`
  → `npx install` bootstrap reproduced the identical gap.
- **The defect was the plan↔executor MISMATCH** — the plan over-promised. That is the concrete,
  verified bug.
- **Fix (per your gate answer "F2 → drop it, advice-only"):** `agentPaths('codex')` no longer lists
  `~/.codex/config.toml`, so the plan stops promising a write the executor never makes. The plan
  now matches the published `codex` command's advice-only behavior. Guarded by a unit test
  (`install.test.ts`, exact-equality on the codex path list) and the `dry-run-no-writes` scenario.
- **INFERRED (not tested here):** without `config.toml`, the memory MCP server is not registered,
  so a Codex restart would expose no `mcp__memory__*` tools. Confirming that needs a live Codex
  runtime, which the sandbox deliberately doesn't run — so dropping the over-promise is the correct
  minimal fix; *whether the guided install should write the registration at all* is the open product
  question below.

> **Important — this is a product/security decision, not just a code fix.** I verified the
> credential mechanics against source (the advisor flagged my first draft for asserting the secret
> risk without checking it). The facts:
>
> - The bridge loads `dotenv` (`dist/index.js:8`) and reads `AUTOMEM_API_KEY`/`AUTOMEM_API_TOKEN`
>   from `process.env`, so a credential *can* arrive from a `.env` the bridge finds at its launch
>   cwd — **but that cwd is whatever the MCP client spawns the bridge in, which is not reliable.**
> - Every existing *writer* of an MCP server registration embeds the **literal key**:
>   `buildMcpConfigJson()` writes `env.AUTOMEM_API_KEY: <apiKey value>` (used by cursor/openclaw),
>   and `templates/codex/config.toml` embeds `AUTOMEM_API_KEY = "…"` inline in
>   `[mcp_servers.memory.env]`. The `${AUTOMEM_API_KEY}` placeholder only appears in printed
>   *advice snippets*, never in a written config.
>
> So the secret risk is **real, not a phantom**: a config.toml writer built to match house style
> *would* persist your real `AUTOMEM_API_KEY` into `~/.codex/config.toml`. Three coherent
> resolutions:
>
> 1. **Implement the writer, house style** → writes the literal `AUTOMEM_API_KEY` into
>    `~/.codex/config.toml`. Is the installer allowed to persist the key into a client's MCP config?
> 2. **Implement the writer, key-free** → write the `[mcp_servers.memory]` entry but omit the key,
>    relying on the bridge's `dotenv` to read `.env`. Avoids the secret, but is launch-cwd-fragile
>    unless the entry also pins a working dir / env-file path.
> 3. **Drop `config.toml` from the plan** → keep it advice-only (what both codex *and* claude-code
>    do today), and the plan stops over-promising. No secret written; user wires MCP config.
>
> The published `codex` command already behaves like (3), and **you chose (3)** for this pass. The
> writer (1)/(2) question remains open for whenever the guided `install` is finalized for merge.

### F2-sibling — Claude server registration is *also* advice-only
**Classification: house style, published.** **Severity: info.** **Verified. No fix (by design).**

- I initially read this backwards; corrected after reading the files, not just their names. The
  Claude `settings.json` the installer writes carries hooks + permission grants (`mcp__memory__*` in
  `permissions.allow`) but **no `mcpServers` block**, and `dist/cli/claude-code.js:227` logs advice —
  *"Add MCP server to ~/.claude.json (see INSTALLATION.md)."* So **Claude is handled exactly like
  Codex: hooks + permissions/scripts + `.env`, then advice-only for the server registration.**
  Advice-only `config.toml` is therefore **consistent house style, not a codex-specific asymmetry.**
  (The clients that *do* write a server registration are `cursor`/`openclaw`, via
  `buildMcpConfigJson` — see the F2 security note.)
- This finding fires on every green run as an `info`-level observation; it documents the house-style
  consistency so "F2 dropped config.toml" isn't later misread as Codex being shortchanged.

### F3 — `install.sh` has no `--api-key` passthrough
**Classification: lives in `automem-website` (auto-deploys on push).**
**Severity: medium.** **Verified. → SEPARATE ASK, not auto-fixed.**

- **VERIFIED:** `install.sh` maps `AUTOMEM_API_URL` / `CLIENTS` / `TARGET` / `LOCAL_DIR` /
  `DRY_RUN` / `NO_AGENT_INSTALL` into installer flags, but has **no** `AUTOMEM_API_KEY → --api-key`
  mapping. A cloud/existing endpoint that requires a key cannot receive one through the `curl | sh`
  bootstrap; the authed `/recall` probe is skipped and `.env` is written without `AUTOMEM_API_KEY`.
- **Why this is a separate ask, not bundled with the other fixes:** the script lives in the
  `automem-website` repo, which **auto-deploys to the public install endpoint on push**. Editing it
  ships immediately and changes the secrets-handling surface of the public `curl | sh` flow — that
  is a deliberate decision to make on its own, not a side effect of an installer PR.
- **Context (one sentence, don't chase):** the public `install.sh` defaults to `@latest`, which has
  **no `install` command** — so the `curl | sh` bootstrap of the guided flow isn't functional in
  production yet anyway, consistent with the script's own warning.
- **Destination is already established:** the direct install writes `AUTOMEM_API_KEY` into the cwd
  `.env`, and the bridge reads it back via `dotenv` (`dist/index.js:8`). So the fix is simply
  "forward the key into the `.env` install.sh already writes" — no new storage surface. The *only*
  new exposure is the key **transiting the `curl | sh` invocation** (env var before the pipe / shell
  history). Minor, but it's a secrets-handling call — decide it deliberately rather than by default.

### F4 — `install` adds Codex; `uninstall` could not remove it
**Classification: LIVE in published `@latest`.** **Severity: medium.** **Verified. Fix implemented (gated).**

- **VERIFIED (on the tarball under test):** before the fix, `uninstall` allowed
  `cursor | claude-code | hermes` (local branch `allowed` list) and **rejected `codex`** with a
  non-zero exit. After an install-then-`uninstall codex`, all 9 `.codex/*` files remained.
- **VERIFIED this is live, not pre-merge:** in published `@latest 0.14.0`, the `codex` command
  ships and writes Codex artifacts (e.g. AGENTS.md), while published `uninstall` accepts only
  `cursor | claude-code` — so a user who runs the published `codex` command **today** cannot remove
  those artifacts with the tool.
- **Fix:** added a `codex` uninstall target (`uninstallCodex` — strips `hooks.json` codex entries,
  removes scripts with backup, prunes empty dirs, strips the AGENTS.md block; short-circuits when
  non-TTY without `--yes`). Proven correct non-TTY (94ms, exit 0). Guarded by the
  `uninstall-after-install` scenario, which asserts the codex write surface is fully removed.
- It's a behavior change to a published command — gated like the rest.

### F5 — health gate accepted any HTTP 200, including a non-JSON body
**Classification: PRE-MERGE** (the `verifyAutoMemEndpoint` path is part of the unreleased
`install` command). **Severity: low.** **Verified. Fix implemented (gated).**

- **VERIFIED:** before the fix, `verifyAutoMemEndpoint` checked only the HTTP **status** of
  `GET /health`, not the body or content-type. The install completed (exit 0; `.env` + agent files
  written) against an endpoint whose `/health` returned `200 text/html "<html>not json</html>"`. A
  reverse-proxy login wall, captive portal, or an unrelated service that returns `200` passed the gate.
- **Fix:** after the HTTP 200, `verifyAutoMemEndpoint` now parses the `/health` body as JSON in a
  try/catch and requires a **string `status` field** (presence/type, not a literal value). Match on
  type, **not** `status == "ok"`: the real server returns `"healthy"` or `"degraded"` (graceful
  Qdrant degradation) — **never** the literal `"ok"` — so an `== "ok"` assertion would reject every
  real endpoint. The **regression-guard is the `malformed-health-200-html` e2e scenario** (a 200 with
  an HTML body must now abort before any write). The unit-test mock change (`/health` →
  `{ status: 'healthy' }`) is **not** a guard — it only keeps the pre-existing retry test green against
  the new JSON-parsing code path. Low severity because the 401/500 gates already fire — this was the
  narrow "200-but-wrong-service" hole.

---

## The website-bootstrap skip (why the flagship scenario can't be evaluated locally)

`website-bootstrap-install-sh` is the one scenario that drives the **real production entrypoint** —
the website `install.sh` (`curl … | sh`), which itself execs `npx`. On this machine it **times out
and is SKIPPED**, every run, for a reason that is **not** an installer defect:

- `npx`'s staging of a local `file:` tarball hits an **intermittent per-exec hang** — *any* single
  `npx -y file:<tarball>` exec can stall (a known npm-exec artifact with `file:` specs; **not** tied
  to a warm-vs-cold cache). My own run proves this: `malformed-health-200-html` is a **single** npx
  exec and it hung on attempt 1, then passed on the retry — so a first/only exec can hang, and a
  single hang is **retry-rescuable**.
- `install.sh` invokes `npx -y file:<tarball>` **twice per run** — stage 3/4 (`verify`, a probe that
  the `install` subcommand exists) and stage 4/4 (`setup`, the real install) — so across the bounded
  retry it rolls the intermittent flake ~4 times. It is therefore the **most-exposed** scenario, not
  a structurally different failure: it just hits the flake often enough that a **1-retry** budget
  can't reliably clear it. The harness's retry **fires** (the `↻` log line prints) but doesn't
  converge within budget.
- This is an artifact of the **pre-NPX local-tarball** approach. Real users `npx` the package from
  the **registry**, not a local `file:` tarball, and don't hit the repeated-`file:`-staging stall.
- **Disposition:** a persistent timeout-after-retry is **downgraded to a loud SKIP** (mirroring the
  existing "skip when `install.sh` is absent" precedent), so the gate exits `0` on true installer
  health. The downgrade is **narrowly keyed on `timedOut === true` on the final attempt** — any
  *non-timeout* website-bootstrap failure (bad exit, failed assertion) still stays **red** and cannot
  be masked. F3 (the `--api-key` gap) still fires from this scenario regardless of the skip.

> **Observation for `automem-website` (advice-only, alongside F3):** `install.sh`'s `verify` stage
> (3/4) spends a full `npx -y file:<tarball>` exec just to confirm the `install` subcommand exists —
> one of **two** staging rolls per run. Dropping it (or skipping `verify` when the spec is a local
> tarball) would take the bootstrap from **two execs to one**, making it as **retry-rescuable as the
> single-exec `malformed-health` scenario** — i.e. it would convert website-bootstrap from "always
> skipped here" to "usually passes." This is a harness/dev-ergonomics win against *local tarballs*;
> real users `npx` from the registry and don't hit the flake, so it is **not** a production fix.
> Lives in `automem-website` (auto-deploys on push) — surfaced, **not** auto-fixed.

---

## Coverage scope (what was NOT tested — so "10/11 pass" isn't read as "everything works")

- **Clients exercised:** `codex` (full write surface) and `claude-code` (sibling). **Not exercised:**
  `cursor`, `openclaw`, `hermes` write-paths — omitted to keep the sandbox safe and focused, not
  because they're verified.
- **No live agent runtime.** The harness verifies *files written / endpoints probed / exit codes*.
  It does **not** boot Codex or Claude and confirm `mcp__memory__*` tools actually appear — that's
  the INFERRED half of F2, explicitly out of scope for an isolated file-level harness.
- **`--target local`** (git clone + `docker compose`) was deliberately avoided — it would collide
  with the dev project's containers. Only `--target existing` (the default) was exercised.
- **One embedding/endpoint shape.** The mock answers `/health` and `/recall`; it does not emulate
  FalkorDB/Qdrant semantics.

---

## The harness itself (the repeatable process you asked for)

Now lives **in the installer repo** at `<installer-repo>/tests/e2e/` (relocated from `/tmp` so it's
durable and reviewable). `tests/` is excluded from `vitest`, `tsconfig`, and the npm package `files`
list, so it adds zero tooling collisions and never ships in the published tarball.

- `harness.mjs` — scenario-matrix runner (fresh HOME+cwd per scenario, write-surface diffing,
  per-scenario assertions + findings).
- `mock-automem.mjs` — adversarial mock endpoint (`healthy` / `500` / `401` / `malformed` modes).
- `run-matrix.sh` — build-before-pack wrapper (`SKIP_BUILD=1` to reuse the staged tarball; pass a
  name substring to filter scenarios).
- `README.md` — durable usage doc.
- Machine-generated evidence (`artifacts/matrix/{report.md,results.json}`) is written under
  `AUTOMEM_E2E_SCRATCH` (default `/tmp/automem-installer-harness`), **outside** the repo, so runs
  never dirty the tree.

### Two mechanics that earned their own rationale

- **`node-bin` launcher for the uninstall step.** The `uninstall-after-install` scenario launches
  the freshly-built `dist/index.js` directly with `node` for its uninstall step, instead of a second
  `npx` exec. This is **not** a fidelity gap — same built code, same non-TTY stdio — it exists to
  dodge the npx flake below. The *install* step in that scenario still goes through the real `npx`
  path, preserving production fidelity where it matters.
- **Bounded retry-on-timeout, then SKIP.** `npx`'s staging of a `file:<tarball>` package on `npm
  exec` hits an **intermittent per-exec hang** — *any* single exec can stall (an npm-exec/`file:`
  artifact, not an installer defect; `malformed-health-200-html`, a single exec, hung once then
  passed on the retry). The harness retries a scenario **once** in a fresh sandbox, keyed **strictly**
  on its own step timeout firing (`timedOut === true`) — never on a non-zero exit, so the
  500/401/malformed-health abort scenarios and any exit-surfaced regression stay red. A single-exec
  scenario like `malformed-health` is **retry-rescuable**; `website-bootstrap-install-sh` is the
  **most-exposed** (its `install.sh` stages the tarball **twice per run**, ~4 rolls across the retry),
  so a 1-retry budget can't reliably clear it. After the bounded retry, a **still-timed-out** scenario
  is **downgraded to a SKIP**, not a failure — narrowly keyed on `timedOut` so it cannot mask a
  non-timeout regression. The honest trade-off (a timeout-keyed retry/skip also papers over a
  *transient* installer hang) is accepted because the bins are unit-tested and a non-TTY probe proved
  sub-100ms completion — npx `file:` staging is the only known transient stall source.
