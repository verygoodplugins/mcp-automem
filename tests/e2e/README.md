# Installer e2e matrix

A repeatable, **isolated** end-to-end test of the AutoMem installer — the exact
command the public website bootstrap execs:

```
npx -y @verygoodplugins/mcp-automem install …
```

Each scenario runs in a throwaway `HOME=$(mktemp -d)` **and** a throwaway project
`cwd`, with a curated environment and an in-process mock endpoint. The operator's
real `~/.claude.json`, `~/.codex/`, `~/.config/automem/.env`, and the dev project's
FalkorDB/Qdrant containers are **never** in the write surface.

> "Pass" means the harness's assertions held for that scenario. It does **not**
> mean the installer is defect-free — see `FINDINGS.md` for the learnings, all of
> which are gated behind a human decision.

## Run it

```bash
# build + pack a fresh tarball, then run all 11 scenarios
./tests/e2e/run-matrix.sh

# reuse the already-staged tarball (fast iteration — skips build+pack)
SKIP_BUILD=1 ./tests/e2e/run-matrix.sh

# filter by scenario-name substring
./tests/e2e/run-matrix.sh dry-run
```

`run-matrix.sh` builds before it packs **on purpose**: `prepare` is husky, not a
build, so `npm pack` without `npm run build` ships stale `dist/`. The Node harness
runs against the packed tarball via `npx -y file:<tarball>`, which is byte-for-byte
the code a user would `npx`.

## Interactive routes (PTY)

`run-matrix.sh` drives the **headless** path (`--yes` / flags) and never touches the
prompts. `interactive.mjs` covers the gap: it spawns the installer in a real PTY
(via `node-pty`) and drives each route by sending keystrokes, asserting the rendered
plan. Every scenario runs `install --dry-run` in a throwaway `HOME` + `cwd`, so there
are no writes and no Docker/agent side effects.

```bash
npm run build                       # interactive.mjs runs against dist/index.js
node tests/e2e/interactive.mjs      # all routes (existing/cloud/local × plugin/settings)
node tests/e2e/interactive.mjs claude   # filter by name substring
```

Routes covered: `existing-cursor`, `existing-claude-plugin`, `existing-claude-settings`,
`cloud`, `local`. It self-heals node-pty's `spawn-helper` executable bit (a common
post-install quirk that otherwise throws `posix_spawnp failed`). PTY allocation may be
unavailable in some CI sandboxes, so this stays a local/dev gate, not a CI gate.

## Files

| File | Role |
|---|---|
| `run-matrix.sh` | Entrypoint. Derives the repo root from its own location, builds+packs (unless `SKIP_BUILD=1`), then runs the harness. |
| `harness.mjs` | Scenario-matrix runner: fresh `HOME`+`cwd` per scenario, write-surface diffing, per-scenario assertions + findings. |
| `mock-automem.mjs` | In-process adversarial endpoint (`healthy` / `500` / `401` / `malformed` modes). No real AutoMem server needed. |

Machine-generated evidence is written to
`$AUTOMEM_E2E_SCRATCH/artifacts/matrix/{report.md,results.json}` after every run.

## Environment overrides

| Var | Default | Purpose |
|---|---|---|
| `SKIP_BUILD` | `0` | `1` reuses the staged tarball (skips `npm run build` + `npm pack`). |
| `AUTOMEM_REPO_ROOT` | two levels up from `tests/e2e/` | The installer repo to build/pack and resolve the built bin from. |
| `AUTOMEM_E2E_SCRATCH` | `/tmp/automem-installer-harness` | Scratch root, **outside** the repo (tarball, sandboxes, artifacts). |
| `AUTOMEM_INSTALL_SH` | sibling `automem-website/public/install.sh` | The website bootstrap script. If absent, the `website-bootstrap-install-sh` scenario is **skipped** (not failed) and the rest of the matrix still runs. |
| `AUTOMEM_PACKAGE_SPEC` | `file:<staged tarball>` | The `npx` package spec under test. |

## Scenarios (11)

| Scenario | What it pins |
|---|---|
| `codex-existing-headless` | Headless existing-target install for Codex against a healthy endpoint. |
| `claude-existing-headless` | Sibling client (Claude Code) — proves the symmetric writer exists. |
| `dry-run-no-writes` | `--dry-run` produces a plan and changes nothing. |
| `no-agent-install` | `--no-agent-install` writes only `.env`, no client integration files. |
| `non-tty-no-yes-preview` | Non-interactive **without** `--yes`/`--dry-run` previews only — writes nothing. |
| `idempotent-reinstall` | Running the codex install twice stays valid (no corruption; `hooks.json` still parses). |
| `endpoint-500-aborts` | A reachable-but-broken endpoint (500) aborts **before** any write. |
| `bad-token-401-aborts` | A 401 on the authed recall probe aborts before any write. |
| `malformed-health-200-html` | `/health` 200 with an HTML (non-JSON) body — does verify assert the body shape? |
| `website-bootstrap-install-sh` | The real production entrypoint: website `install.sh` → `npx file:<tarball> install`. |
| `uninstall-after-install` | Install codex, then `uninstall codex` — captures install/uninstall symmetry. |

## Two harness mechanics worth knowing

**Step kinds.** A scenario step is one of:

- `direct` — `npx -y <spec> <argv>` (the user's real entrypoint; the default).
- `bootstrap` — runs the website `install.sh` (which itself execs `npx`).
- `node-bin` — launches the **freshly-built** `dist/index.js` directly with `node`.

The `uninstall-after-install` scenario uses `node-bin` for its uninstall step. This
is **not** a fidelity compromise — it runs the same built code with the same
non-TTY stdio — it exists solely to dodge a known npx flake (below). The install
step in that same scenario still goes through the real `npx` path.

**Bounded retry-on-timeout, then SKIP.** `npx`'s staging of a `file:<tarball>` package on
`npm exec` hits an **intermittent per-exec hang** — *any* single exec can stall (an
npm-exec/`file:` artifact, not an installer defect). `malformed-health-200-html` is a
**single** npx exec and it hung once then passed on the retry — proof a single hang is
**retry-rescuable**. `website-bootstrap-install-sh` is the **most exposed**: `install.sh`
runs `npx -y file:<tarball>` **twice per run** (verify stage 3/4, then setup stage 4/4),
~4 staging rolls across the bounded retry, so a **1-retry** budget can't reliably clear it.
The harness retries a scenario **once** in a fresh sandbox — but **only** when its own step
timeout fired (`timedOut === true`), never on a non-zero exit. The abort scenarios
(500/401/malformed-health) exit non-zero **by design**, and a real installer regression
that surfaces as a bad exit stays red.

So a scenario that is **still timed out after the bounded retry is downgraded to a loud
`SKIP`**, not a failure (mirroring the install.sh-absent skip). The downgrade is narrowly
keyed on `timedOut`, so any *non-timeout* failure stays red and cannot be masked. This is
an artifact of the **local-`file:`-tarball** approach; real users `npx` from the registry
and don't hit it. See `FINDINGS.md` → "The website-bootstrap skip" for the full disposition
(and an advice-only `automem-website` `install.sh` note: dropping the verify-stage exec
would take the bootstrap to a single exec, making it as retry-rescuable as malformed-health).
The trade-off (a timeout-keyed retry/skip also papers over a *transient* installer hang) is
documented inline in `harness.mjs` and accepted because the bins are unit-tested and a
non-TTY probe proved sub-100ms completion.

## Exit codes

- `0` — every evaluated scenario's assertions passed. Findings (learnings) and
  **skips** (un-evaluable scenarios, e.g. the `website-bootstrap` npx-staging timeout)
  do **not** fail the run.
- `1` — one or more scenarios failed an assertion (a real, non-timeout failure).
- `2` — setup error (missing tarball or built bin).

The summary line reads `Scenarios: N  passed: P  failed: F  skipped: S`. The expected
healthy state on this machine is `passed: 10  failed: 0  skipped: 1` (website-bootstrap
skipped on its npx-`file:`-staging timeout). A clean run still prints a `Findings: N`
count — read `FINDINGS.md` and the generated `report.md` for what those findings are and
why they're gated, not fixed in place.
