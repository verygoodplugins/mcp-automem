# Dependabot auto-merge

This maintainer runbook documents the repository's existing dependency-update
automation. For agent-driven PR review, CI triage, and readiness, use the installed
`babysit` skill (`~/.autovault/skills/babysit/SKILL.md`).

`.github/workflows/dependabot-auto-merge.yml` enables GitHub auto-merge (squash) on
Dependabot PRs for `version-update:semver-patch` and `version-update:semver-minor`
bumps. Eligible updates merge automatically once GitHub's required checks and
branch rules are satisfied.

Majors are not auto-merged: review the `dev-vitest-majors`, `dev-toolchain-majors` and
`dev-other-majors` group PRs by hand. Vitest majors are grouped separately from the
typescript/eslint toolchain because a group lands as one PR, so one upstream peer ceiling
blocks all of it — see the comment in `.github/dependabot.yml`.

It arms on `opened`, `reopened` and `synchronize`, so it only covers a PR that sees one
of those events. A Dependabot PR already open when the workflow lands gets no event just
because the workflow file appeared, and stays unarmed until its branch next moves. To
backfill one, comment `@dependabot recreate` on it: Dependabot force-pushes the branch,
which fires `synchronize` and arms it. (The backlog that existed at rollout was merged by
hand instead.)

Eligibility is decided by commit provenance, not by who triggered the run: the job
runs whenever the PR *author* is Dependabot, then arms auto-merge only if every commit on the head is Dependabot's, and otherwise cancels any
auto-merge already armed. So a human push to an armed branch cancels instead of riding
in, while a maintainer merely reopening an untouched Dependabot PR still arms. An
unattributed commit has no login and fails closed.

**The workflow merges with a GitHub App token, not `GITHUB_TOKEN`.** GitHub does not
start new workflow runs from events caused by `GITHUB_TOKEN`, and that extends to the
merge an auto-merge it armed performs. Measured on this repo: the three bumps that
auto-merged under `GITHUB_TOKEN` — 5775c95 (#245), 07db972 (#247) and 9ed9084 (#246) —
each produced **0** `event=push` workflow runs, while the human merges on either side,
d2a2660 (#242) and 06f6fb1 (#238), each produced **4**: CI, Release Please, Docs Dispatch
and Security.

```bash
gh api "repos/verygoodplugins/mcp-automem/actions/runs?head_sha=<merge-sha>&event=push" --jq '.total_count'
```

Filter on `event=push`. A bare total is misleading: 5775c95 reports 2 runs, both
Dependabot's own `event=dynamic` update runs attached to main's head, and 0 push runs.

Three workflows are triggered by `push: branches: [main]`: `ci.yml`,
`release-please.yml` and `security.yml`. **Docs Dispatch is not one of them** — it is a
`workflow_call` from `release-please.yml`, gated on `release_created`, so it shows up as
an inherited `event=push` run only on a push that actually cuts a release. Expect **3**
push runs on an ordinary bump and **4** when a release is cut; 3 is not a failure. So
merging under
`GITHUB_TOKEN` cost: no release-PR update, which stalls releases until the next human
merge (release-please accumulates, so this delays rather than loses them); no
push-to-main CI run, which is the only thing that tests bumps *in combination*, because
the `MCP TypeScript CI` ruleset sets `strict_required_status_checks_policy: false` and
each PR's own CI ran against an older base; and no npm audit or CodeQL.

A GitHub App installation token is not `GITHUB_TOKEN`, so merges it performs do start
those runs. `actions/create-github-app-token` mints one from two secrets,
`AUTOMERGE_APP_CLIENT_ID` and `AUTOMERGE_APP_PRIVATE_KEY`. Add both as **Actions secrets
and as Dependabot secrets**: the job runs as Dependabot on `opened`/`synchronize` and as
a maintainer on `reopened`, and if secret resolution depends on the actor those paths read
different stores. The App must be installed on this repository with Contents read/write,
Pull requests read/write and Metadata read.
**If either secret is missing the mint step fails and nothing auto-merges at all** — the
cancel step still runs on a `GITHUB_TOKEN` fallback, so an already-armed auto-merge is
disarmed rather than left to fire. If the `github-actions` ecosystem is ever added to
`dependabot.yml`, two grants are needed, not one: `Workflows: write` on the App *and*
`permission-workflows: write` on the token step. `create-github-app-token` scopes the
token it mints to the `permission-*` inputs it is given, so widening the App alone leaves
the minted token without workflow permission — and either gap stops the merge of a PR
that touches `.github/workflows/`.

**A merge queue would need the same token, and now has it.** PR #178 added `merge_group`
support to `ci.yml` and `semantic-pr-title.yml` so a merge-queue ruleset *could* be
turned on, but no such rule exists today — no ruleset carries a `merge_queue` rule and
`mergeQueue(branch: "main")` is null. `GITHUB_TOKEN` cannot add a pull request to a merge
queue, which used to mean the token had to be swapped in the same commit that enabled the
queue; the App token already covers that. If a queue is enabled, check whether the App
also needs merge-queue permission.

Two things worth knowing when a Dependabot PR does not merge:

- **Unresolved review threads block the merge.** The `Protect MCP Main Branches`
  ruleset sets `required_review_thread_resolution`, so a single unresolved review
  thread holds a PR at `BLOCKED` even with every check green and auto-merge armed.
  Resolve the thread and the merge fires on its own.
- **`Check Links` is not a required check.** Only `test` and `semantic-pr-title` are
  required, so transient link-rot in docs does not block auto-merge.
