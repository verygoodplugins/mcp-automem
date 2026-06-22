# AGENTS.md

This file provides guidance to coding agents (Claude Code, Cursor, Codex, etc.) when working with code in this repository. It is the single source of truth; `CLAUDE.md` imports it via `@AGENTS.md`.

Migration note: if you previously had a local, gitignored `AGENTS.md`, delete it before pulling (or run `git clean -f AGENTS.md`) to avoid checkout/merge errors.

## Project Overview

**MCP AutoMem** is an MCP (Model Context Protocol) server that bridges AI assistants like Claude with the AutoMem memory service. It enables AI to store, recall, and associate memories using FalkorDB (graph database) and Qdrant (vector search).

**Core Purpose:**
- Translate MCP tool calls into AutoMem API requests
- Provide memory management for AI assistants (storage, hybrid search, relationships)
- Support Claude Code integration with session-recall and opt-in storage-nudge hooks

## Build & Development

```bash
# Build TypeScript to dist/
npm run build

# Development with hot-reload
npm run dev

# Test server help output
npm test

# Publish preparation
npm run prepublishOnly  # Runs build automatically
```

## Commit Standards (Required)

This repo uses **Conventional Commits** so Release Please can generate releases reliably.

Accepted examples:
```text
fix: prevent stdout corruption in stdio mode
feat: add cursor setup command
chore: update dependencies
docs: clarify Claude Desktop config
```

Notes:
- PR titles must be Conventional Commit format because we squash-merge and the PR title becomes the merge commit message.
- A git `commit-msg` hook (Husky + Commitlint) is included to catch mistakes locally, and CI enforces PR titles.

## Pull Request & Copilot Review Process (Mandatory)

**Copilot Review Completeness Rule** (applies to every agent, including Claude Code, Cursor, Codex, Grok, etc.):

- Every PR must receive a GitHub Copilot review.
- When opening a PR in a **published / ready (non-draft) state**, immediately trigger review with the `/copilot-review` comment (our standard convention):
  ```bash
  gh pr comment <PR> --body "/copilot-review"
  ```
- A PR is **not ready for human merge** until:
  - Copilot has submitted a completed review on the current head.
  - **Zero** unresolved, non-outdated Copilot review threads remain.
  - Every thread was either:
    - Fixed with the smallest correct code change, replied to, and resolved, **or**
    - Well-addressed with a specific, code-based reply explaining why no change was made (resolved where appropriate).
  - **If a comment identifies a real issue, fix it.** Strong bias toward making the fix.

- After any fix push on the PR branch, re-trigger with `/copilot-review` and repeat the process.
- Use the `copilot-review` skill (or equivalent systematic process) to walk threads when they exist.
- In the final PR summary / handoff, explicitly state how many threads were addressed and confirm the review is clean.

This rule exists because open Copilot comments on merged PRs create technical debt and surprise the next person who touches the code.

**Grok's personal standing rule (internalized as default behavior):** I will never hand off a PR I'm involved with while Copilot threads are dangling. I treat the review as a hard gate. "Well-addressed" always includes an actual reply + resolution. If a fix is warranted, I make the fix. I re-trigger `/copilot-review` after pushes until the review is clean on the final head. I use the `copilot-review` skill (or equivalent) to systematically process threads rather than doing ad-hoc fixes.

## Key Commands

### CLI Commands (via npx or global install)

```bash
# Guided installer: pick target (local/cloud/existing), verify the endpoint,
# write .env, and configure agents. Claude Code defaults to the plugin: when the
# `claude` CLI is on PATH the installer runs `claude plugin install` directly
# (threading the endpoint/key as --config; see installClaudeCodePlugin), else it
# falls back to printing the /plugin commands. --claude-code-mode settings selects
# the file writer instead. --target cloud picks a provider (--cloud-provider
# instapods|railway|other). InstaPods opens the create-page
# (app.instapods.com/dashboard/pods/create?app=automem...&ref=jack) which deploys +
# emails the URL+key, then the user pastes it (apply phase); InstaPods has no
# app-deploy API/CLI so this is link+paste, NOT API-driven. Railway IS guided, but
# the deploy is BROWSER-driven (marketplace templates can't be CLI-deployed —
# `railway deploy --template` returns Unauthorized): `railway login` browser hand-off
# → open the Deploy-Now page (railway.com/deploy/automem-ai-memory-service) → user
# confirms it's live → `railway link` (interactive project picker) → READ the
# template-generated domain + token (never generate a domain; a mismatched target
# port was the original 502) → store as local AUTOMEM_API_KEY. The token read is
# migration-proof (tries AUTOMEM_API_KEY, falls back to AUTOMEM_API_TOKEN). All of
# this sits behind the provider-agnostic CloudProvider interface (src/cli/cloud/*,
# reusable for AutoMem's own API-driven cloud). `other` = paste an existing
# endpoint+token up front (resolve phase). Railway/InstaPods degrade to a manual
# paste; the Railway deploy hand-off runs in apply (after plan approval); --dry-run
# never auths/deploys/charges. AUTOMEM_NO_BROWSER=1 suppresses the browser open (CI /
# the demo). Gold-themed
# @inquirer/prompts (clack's green accent isn't themable); branded UI toolkit in
# src/cli/ui/* (theme/table/messages/brand/tasks/animate/prompts) + the mascot in
# src/cli/install-ui.ts. Interactive prompt routes are tested with a node-pty
# harness: `node tests/e2e/interactive.mjs` (drives each route in a PTY, dry-run;
# the cloud-instapods/cloud-railway/cloud-other routes cover the provider split).
npx @verygoodplugins/mcp-automem install
npx @verygoodplugins/mcp-automem install --dry-run                # Preview the plan
npx @verygoodplugins/mcp-automem install --yes --target existing --endpoint <url>

# Guided setup wizard (creates .env, prints config snippets)
npx @verygoodplugins/mcp-automem setup

# Install Claude Code automation hooks & merge settings
npx @verygoodplugins/mcp-automem claude-code
npx @verygoodplugins/mcp-automem claude-code --dry-run           # Preview changes
npx @verygoodplugins/mcp-automem claude-code --dir <path>        # Custom target directory

# Print config snippets for Claude Desktop/Cursor/Code
npx @verygoodplugins/mcp-automem config --format=json

# Drain a memory queue file (manual-only; no hooks write to or drain the queue anymore)
npx @verygoodplugins/mcp-automem queue
npx @verygoodplugins/mcp-automem queue --file ~/.claude/scripts/memory-queue.jsonl
```

### Testing MCP Server Locally

```bash
# Start the MCP server directly (stdio mode)
node dist/index.js

# Or via npm start
npm start
```

The server expects `AUTOMEM_API_URL` (and optionally `AUTOMEM_API_KEY`) in environment or `.env` file. `AUTOMEM_ENDPOINT` is the deprecated alias and is still read as a fallback.

## Architecture

```
┌─────────────────────────────────────────┐
│  MCP Client (Claude Desktop/Code/Cursor) │
│  - Calls MCP tools via stdio/SSE        │
└─────────────┬───────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────┐
│  MCP AutoMem Server (this TypeScript app)│
│  - src/index.ts: MCP Server setup       │
│  - src/automem-client.ts: API client    │
│  - src/cli/*: Setup/queue/config CLIs   │
│  - Translates MCP calls → HTTP API      │
└─────────────┬───────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────┐
│  AutoMem Service (Python Flask API)     │
│  - /memory (POST/PATCH/DELETE)          │
│  - /recall (GET with hybrid search)     │
│  - /associate (POST relationships)      │
│  - /health (GET status)                 │
│  - Stores in FalkorDB + Qdrant          │
└──────────────────────────────────────────┘
```

### Code Organization

```
src/
├── index.ts              # MCP server entry point, tool registration, handlers
├── automem-client.ts     # HTTP client for AutoMem API
├── types.ts              # TypeScript interfaces (configs, args, results)
└── cli/
    ├── setup.ts          # Setup wizard (creates .env, prints config)
    ├── claude-code.ts    # Claude Code hook installation
    ├── queue.ts          # Memory queue processor (drains queue → AutoMem)
    ├── templates.ts      # Config snippet generation
    └── cloud/            # Hosted-cloud provisioning (install --target cloud)
        ├── types.ts          # CloudProvider interface + shared types (provider-agnostic)
        ├── orchestrate.ts    # selectCloudIntent (resolve) + executeCloudIntent (apply)
        ├── browser-auth.ts   # openInSystemBrowser (+ reserved loopback OAuth helpers)
        ├── railway.ts        # Railway CloudProvider (drives `railway` CLI; argv/JSON = CONFIRM-pending)
        └── installer-bridge.ts # provisionViaInstaPodsLink (link+paste) + provisionViaProvider/provisionViaRailway + promptManualCredentials

templates/
├── claude-code/
│   ├── hooks/            # SessionStart recall prompt, store tracker, opt-in Stop storage nudge
│   ├── settings.json     # Default (silent) hook config: SessionStart + PostToolUse only
│   └── settings.stop-nudge.json  # Extra Stop-hook registration, merged in by --profile nudged
├── CLAUDE_CODE_INTEGRATION.md   # Complete hook system documentation
└── CLAUDE_MD_MEMORY_RULES.md    # Memory rules template for ~/.claude/CLAUDE.md
```

## MCP Tools

The server exposes 6 tools to AI assistants. Several are mode-multiplexed — the mode is selected by which params you pass, so the tool count stays small while the surface area covers all of AutoMem's memory CRUD endpoints.

1. **store_memory** — Two modes:
   - **Single (default):** `content` plus optional `tags`, `importance`, `metadata`, `type`, `confidence`, `embedding`, `t_valid`, `t_invalid`, `id`.
   - **Batch:** `memories: [...]` (≤500 items) for bulk ingestion. Per-item `id`, `embedding`, `t_valid`, `t_invalid` are NOT supported in batch mode — use single-mode for those.
2. **recall_memory** — Three modes:
   - **ID fetch:** `memory_id` → routes to `GET /memory/{id}` and ignores other params.
   - **Tag enumeration:** `tags` + `exhaustive: true` → routes to `GET /memory/by-tag` for paginated exact-match listing. Pair with `limit` (≤200) and `offset`. Returns `has_more`/`limit`/`offset`. Use this for cleanup/audit workflows where ranked recall undercounts.
   - **Ranked retrieval (default):** hybrid search across vector, keyword, tags, recency/state controls, score filters, and graph expansion. Supports `query`/`queries`, `embedding`, `limit`, `time_query`, `tags`, `tag_mode`, `tag_match`, `exclude_tags`, expansion options including `expand_respect_tags`, `state_mode`, `recency_bias`, `scope_fallback`, `min_score`, `adaptive_floor`, context hints, and pagination (`offset`, `sort`, `format`). Responses preserve diagnostics such as `state_mode`, `tag_scope`, `scope_fallback`, `recency_bias`, `score_filter`, `queries`, `query_time_ms`, `vector_search`, `jit_enriched_count`, `entities`, plus per-result `outside_tag_scope`, `deduped_from`, `state_replaces`, and enrichment/provenance flags. Responses are token-budgeted (default ~18k estimated tokens, override via `AUTOMEM_RECALL_TOKEN_BUDGET`) to stay under MCP client caps: `text`/`items`/`detailed` formats are summary-first (the stored summary replaces the content preview when present), relations collapse to `{id, type, strength, summary}` stubs, and metadata collapses to `metadata_keys`. `format: "json"` and ID fetches keep full per-field passthrough.
3. **associate_memories** — Create relationships (11 public authorable types only). Supports single-pair mode or batch mode via `associations: [...]` (≤500), with relation-specific props such as `reason`, `context`, `resolution`, `observations`, `transformation`, and `role`.
4. **update_memory** — Update existing memory fields (supports `MEMORY_TYPES` enum for `type`).
5. **delete_memory** — Two modes:
   - **Single (default):** `memory_id` → deletes one memory + its embedding.
   - **Bulk-by-tag:** `tags: [...]` → bulk-deletes ALL memories matching ANY tag (exact, case-insensitive). No dry-run; verify with `recall_memory({ tags, exhaustive: true })` first.
6. **check_database_health** — Check FalkorDB/Qdrant connection status, degraded state, sync counts, vector dimensions, and enrichment diagnostics when the service provides them.

**Note:** `search_by_tag` tool removed in v0.2.0; use `recall_memory` with `tags` parameter instead. The `get_memory`, `list_memories_by_tag`, `delete_memories_by_tag`, and `store_memories_batch` capabilities ship as parameter-extended modes on the tools above (per the global "Resist Tool Bloat" guidance) rather than as separate tools.

## Claude Code Integration

Two install modes ship the same policy-generated behavior:

- **Plugin (recommended for users):** the marketplace payload in `plugins/automem/` + the catalog at `.claude-plugin/marketplace.json`. Bundles the MCP server (plugin tool names are namespaced: `mcp__plugin_automem_memory__*`), two hooks via `hooks/hooks.json` (SessionStart recall + PostToolUse store tracker — the Stop nudge is not registered by the plugin), the memory-management skill, and slash commands. `userConfig` in `plugin.json` prompts for the API URL/key at enable time; Claude Code exports the answers as `CLAUDE_PLUGIN_OPTION_*` env vars, which the server resolves in `src/env.ts` (between `AUTOMEM_API_URL` and the deprecated `AUTOMEM_ENDPOINT` — never wire them through the plugin's `.mcp.json` env, see `tests/installer/plugin-mcp-config.test.ts`).
- **CLI installer (settings-level alternative + migration path):** the `claude-code` command writes hook scripts into `~/.claude/hooks/` and merges hook registrations plus exactly the six `mcp__memory__*` permissions into `~/.claude/settings.json` — nothing else (no `Bash(*)` grants, env, or deny/ask blocks; re-runs strip the retired hook-era grants via `RETIRED_PERMISSIONS`). By default (`--profile silent`) it registers only SessionStart + PostToolUse; pass `--profile nudged` to also merge `settings.stop-nudge.json` and register the Stop storage-nudge hook.

The hooks are built around LLM-judged storage — the model decides what is durable; hooks only prompt and observe, never write memories themselves. The default install registers two hooks; the Stop nudge is opt-in (see below):
- **SessionStart** (`automem-session-start.sh`): injects the two-phase recall prompt plus in-turn recall→store→verify→associate guidance for normal work
- **PostToolUse** on `mcp__.*__store_memory` (`automem-track-store.sh`): writes a per-session sentinel recording that a store happened
- **Stop** (`automem-stop-nudge.sh`) — **opt-in, not registered by default**: added only by the CLI installer's `--profile nudged` (the plugin never registers it; the script is still bundled but inert). When registered, it fires at most once per session, and only if no store happened AND the transcript shows a substantive session (≥5 human prompts, counted from `transcript_path` excluding tool-result and meta entries); it then emits a one-line, neutral-factual `hookSpecificOutput.additionalContext` (with the required `hookEventName`) noting nothing has been stored and listing durable vs non-durable candidates. Below the threshold it exits without burning its once-per-session sentinel, so it can still fire later in the same session. It is opt-in because Claude Code renders Stop-hook `additionalContext` as a visible "Stop hook feedback" block and rewakes Claude for one closing turn — a firing Stop hook cannot be made silent (`suppressOutput: true` only hides the hook's raw stdout, verified empirically on 2.1.175); the default install keeps session end quiet by not registering it at all.

The installed hooks are pure bash+sed+grep — the integration no longer requires Python or jq.

**Retired (auto-removed from existing installs on re-run, settings entries AND files):** the mechanical `capture-build-result.sh` / `capture-test-pattern.sh` / `capture-deployment.sh` PostToolUse hooks (templated "Build succeeded…" / "Deployed X to production…" one-liners were corpus noise that outranked real memories), the `session-memory.sh` Stop hook (#130) with its `process-session-memory.py` / `memory-filters.json` support chain, the queue Stop machinery (`queue-cleanup.sh` + the npx queue drainer + `python-command.sh`) — nothing writes to the queue once the capture hooks are gone — and the four hook-era permission grants that existed only for that machinery (`Bash(python3:*)`, `Bash(python:*)`, `Bash(py:*)`, `Bash(jq:*)`; `RETIRED_PERMISSIONS` in `src/cli/claude-code.ts`). Generic grants earlier templates shipped (`Bash(git:*)`, `Edit`, …) are user-owned and never stripped. `smart-notify.sh` is no longer shipped but is never removed from user machines.

**Modified Files:**
- `~/.claude/settings.json` - Merges tool permissions and hook configurations
- `~/.claude/hooks/*.sh` - Hook scripts (triggered by SessionStart and PostToolUse; plus Stop when installed via `--profile nudged`)

**Key Implementation Details:**
- `npx mcp-automem queue` remains as a manual-only CLI: it drains a JSONL queue file you point it at and stores entries via `store_memory`. No hook registers it.
- Relationships are optional: if a queue entry includes `relatesTo`, the processor creates that association; otherwise none are created automatically
- AutoMem enriches in background (entities, summaries, temporal links)

See `templates/CLAUDE_CODE_INTEGRATION.md` for complete architecture, hook system, troubleshooting.

## Environment Variables

```env
# Required: AutoMem service URL
# For local development:
AUTOMEM_API_URL=http://127.0.0.1:8001
# Or for Railway deployment (your own instance):
AUTOMEM_API_URL=https://your-automem-instance.railway.app
# (AUTOMEM_ENDPOINT is the deprecated name and is still read as a fallback.)

# Optional: API key for authenticated AutoMem instances
AUTOMEM_API_KEY=your_api_key_here

# Optional (advanced): parent-liveness watchdog poll interval, in milliseconds.
# The stdio server self-terminates when its launching client dies; this controls
# how often it polls (default 30000). POSIX only — no effect on Windows, which
# does not reparent orphans. Zero, negative, or non-numeric values fall back to
# the 30000 default; the watchdog cannot be disabled (it is the fix for an
# orphaned-process memory leak — see src/lifecycle.ts).
AUTOMEM_PARENT_WATCHDOG_MS=30000

# Optional (advanced): recall response budget, in estimated tokens (default
# 18000). Recall responses tokenize at ~2.5 chars/token; the budget keeps them
# under MCP client tool-response caps (~25k tokens in Claude Code). Raise it
# only for hosts with larger caps — see src/recall-memory.ts.
AUTOMEM_RECALL_TOKEN_BUDGET=18000
```

## Common Tasks

**Add a new MCP tool:**
1. Define tool schema in `tools` array in `src/index.ts` (with inputSchema)
2. Add handler in `CallToolRequestSchema` switch statement
3. Add corresponding method to `AutoMemClient` if API call needed
4. Update `src/types.ts` with new argument types

**Modify memory policy / recall rules:**
1. Edit the shared policy source in `src/memory-policy/shared.ts`
2. Run `npx tsx scripts/sync-memory-policy.ts` (or `npm run build`, which runs it during `prebuild`)
3. Do not hand-edit generated policy artifacts: `templates/claude-code/hooks/automem-session-start.sh`, `templates/claude-code/hooks/automem-stop-nudge.sh`, `templates/claude-code/hooks/automem-track-store.sh`, `plugins/automem/scripts/session-start.sh`, `plugins/automem/scripts/stop-nudge.sh`, `plugins/automem/scripts/track-store.sh`, `templates/codex/memory-rules.md`, `templates/cursor/automem.mdc.template`, `templates/CLAUDE_DESKTOP_INSTRUCTIONS.md`, `templates/CLAUDE_MD_MEMORY_RULES.md`, `templates/hermes/memory-rules.md`, or `templates/hermes/provider/automem_policy.py`
4. Update `src/memory-policy.test.ts` when the shared policy contract changes

**Modify non-policy hook behavior:**
1. Edit hook scripts in `templates/claude-code/hooks/*.sh` unless the hook is generated by the shared memory policy
2. Update settings template in `templates/claude-code/settings.json`
3. Test with `--dry-run` flag before applying
4. Rebuild with `npm run build` if modifying TypeScript code

**Add new CLI command:**
1. Create handler in `src/cli/<command>.ts`
2. Export main function (e.g., `runCommandName`)
3. Import and register in `src/index.ts` command routing
4. Update README with usage examples

## Testing

**Manual MCP server testing:**
```bash
# Start server with test endpoint
npm run dev

# In another terminal, simulate MCP client
echo '{"jsonrpc":"2.0","method":"tools/list","id":1}' | node dist/index.js
```

**Test Claude Code setup without applying:**
```bash
npm run build
npx @verygoodplugins/mcp-automem claude-code --dry-run --dir /tmp/test-claude
```

**Test queue processor (manual-only CLI):**
```bash
# Create test queue file
echo '{"content":"test memory","tags":["test"],"importance":0.5}' > /tmp/test-queue.jsonl

# Process it
npx @verygoodplugins/mcp-automem queue --file /tmp/test-queue.jsonl
```

### Host integration smoke tests

When adding or changing a client host integration, test the real host boundary instead of only checking generated config.

- Use a temp home or workspace for the host so tests never mutate the developer's real config.
- Use the shared fake AutoMem API for `/health`, recall, store, update, and associate calls.
- Start the real stdio MCP server process from the configured command and assert stdout contains only MCP JSON-RPC.
- When the host is installed locally, instantiate the real host agent or CLI surface and capture provider-visible tool names before any live model call.
- Assert tool names are unique across the final provider payload, not just within AutoMem tools.
- Add uninstall coverage for every file, config key, plugin directory, and environment key the installer writes.
- Redact secrets and isolate env vars; never let a real `AUTOMEM_API_KEY` leak into temp config or snapshots.
- Keep `tests/helpers/host-specs.ts` updated as the executable host integration contract for Hermes, Claude Code, Codex, Cursor, and future platforms.

Documentation changes are part of the integration contract. Any new host mode or uninstall behavior should be reflected in `INSTALLATION.md` and covered by a smoke/doc assertion.

## Publishing Workflow

1. Update version in `package.json`
2. Update `CHANGELOG.md` with changes
3. Build: `npm run build`
4. Test: `npm test`
5. Publish: `npm publish` (requires npm login)

**Pre-publish checks:**
- `npm run build` succeeds
- `dist/` contains compiled JS + declarations + maps
- `package.json` main/bin/types point to correct dist files
- Templates directory included in published package

## Important Patterns

**AutoMem API Response Mapping:**
- Memory IDs may be returned as `memory_id`, `id`, or nested in `response.memory_id`
- Timestamps in service responses may be `timestamp`, `created_at`, or `updated_at`; client code normalizes these (see `automem-client.ts`)

**Storage Timestamp and Tagging Guidelines:**
- When queuing/storing a memory from hooks or tools, set a single top‑level `timestamp` (ISO 8601 UTC). Do not set `metadata.timestamp` and do not add date‑derived tags.
- Prefer precise, namespace‑style tags (e.g., `slack/channel-ops`) instead of free‑form text tags.
- For recall, prefer `recall_memory` with `tags` and optionally a `query`:
  - Defaults (server‑side): `tag_mode=any`, `tag_match=prefix` (prefix supports namespaces like `slack:*`).
  - You can specify `tag_mode=all` to require all tags, or `tag_match=exact` for strict matches.

**Hook Script Patterns:**
- Hooks read a JSON payload on stdin (Claude Code's hook input format: `session_id`, `hook_event_name`, `source`, …) and parse it with sed — no Python or jq dependency.
- All hooks should be idempotent and safe to retry (sentinel files in `${TMPDIR:-/tmp}` guard once-per-session behavior).
- Queue format (manual `mcp-automem queue` CLI): JSONL (one JSON object per line)
- Template hook scripts in `templates/` are duplicated in `plugins/` for distribution; update both when changing hook behavior.

**Settings Merge Strategy:**
- `mergeSettings()` in `claude-code.ts` preserves existing configs
- Arrays merged via `mergeUniqueStrings()` (deduplicates)
- Hook entries merged via `mergeHookEntries()` (by matcher)
- Backups created automatically before modification

## Relationship Types (Memory Graph)

When using `associate_memories`, only these 11 public authorable types are valid inputs:
- **RELATES_TO**: General connection
- **LEADS_TO**: Causal (bug→solution)
- **OCCURRED_BEFORE**: Temporal sequence
- **PREFERS_OVER**: User/team preferences
- **EXEMPLIFIES**: Pattern examples
- **CONTRADICTS**: Conflicting approaches
- **REINFORCES**: Supporting evidence
- **INVALIDATED_BY**: Outdated information
- **EVOLVED_INTO**: Knowledge evolution
- **DERIVED_FROM**: Source relationships
- **PART_OF**: Hierarchical structure

System/internal relations such as `SIMILAR_TO`, `PRECEDED_BY`, `EXPLAINS`, `SHARES_THEME`, `PARALLEL_CONTEXT`, and `DISCOVERED` may still appear in recall results, but they are not valid authoring types for `associate_memories`.

## References

- AutoMem service: https://github.com/verygoodplugins/automem
- MCP specification: https://modelcontextprotocol.io/
- Full integration guide: `templates/CLAUDE_CODE_INTEGRATION.md`
- Memory rules template: `templates/CLAUDE_MD_MEMORY_RULES.md`

<!-- BEGIN AUTOMEM CODEX RULES -->
<!-- automem-template-version: 0.15.0 -->

## Memory - AutoMem (persistent context for mcp-automem)

AutoMem is wired as the `memory` MCP server (see `~/.codex/config.toml`). Tools are `mcp__memory__*`. Use this layer proactively for continuity across turns.

## Tool's real behavior (validated against production corpus)

- **Tags are a hard gate** - memories without matching tags are excluded before scoring. Use tags for stable categories like `preference` and `bugfix`; do not guess topic tags.
- **One good query beats `queries[]` + `auto_decompose`** for focused tasks. Use `queries[]` only for genuinely multi-topic questions.
- **`limit` caps at 50.** Routine recall should use enough budget to be useful.
- **Default `text` format shows content previews with created/updated timestamps and importance.** `detailed` adds type/confidence/metadata summary. Responses are budget-capped; fetch a full record with `recall_memory({ memory_id })`.
- **`store_memory` can silently fail.** Verify important stores by recalling a distinctive phrase; retry once if missing.
- **Bare tag convention** - use `automem`, not `project/automem`; no `lang/` prefixes, platform tags, or date-stamped tags. `entity:*:*` tags are server-injected.

### Slug-collision rule

Drop the project tag gate when the slug collides with common topic words: `api`, `app`, `test`, `video`. Use semantic query alone in that case.

## Session start — two-phase recall

Standardized defaults: preferences limit 20, task-context limit 30, 90-day task window.

Preferences and task context are independent recalls - issue them in parallel in a single message.

Preferences first:

```javascript
mcp__memory__recall_memory({
  tags: ["preference"],
  limit: 20,
  sort: "updated_desc"
})
```

Task context: one semantic query built from proper nouns, products, files, error strings, tools, and specific topics in the user message.

```javascript
mcp__memory__recall_memory({
  query: "<proper nouns, product names, people, tools, specific topics from the user's message>",
  tags: ["mcp-automem"],        // drop if slug collides with a common word
  time_query: "last 90 days",
  limit: 30,
  language: "<typescript|python|go|rust|...>" // optional ranker
})
```

Skip task-context recall for pure syntax questions, trivial edits, one-off calculations, direct factual queries about current files, or casual openings.

Debug context, only when actively investigating a concrete symptom:

```javascript
mcp__memory__recall_memory({
  query: "<error symptom or exact message>",
  limit: 20
})
```

No tag gate on debug recall - bugfix/solution tagging is incomplete and a hard gate hides cross-corpus fixes.

Don't re-recall mid-conversation unless the topic genuinely shifts, a new proper noun enters, or active debugging starts.

### When recall misses

Escalate only when the task-context recall comes back too broad or empty:

- **Too broad** - add a tag gate (a stable category like `preference`/`bugfix`, or the unambiguous project slug) and tighten the query to the real nouns.
- **Empty** - drop the time window first (the topic may be dormant-but-important), then broaden the query.
- **Sparse under a tag gate** - drop the gate and rely on the semantic query alone; older memories use `project/<slug>` prefixes, so gated queries can miss historical content.
- **Need graph traversal** - use `expand_relations: true`; add `expand_respect_tags: true` when traversal must stay inside the tag gate, or leave it false/drop tags when broader graph context is useful.

## Storage Discipline

Store only durable decisions, corrections, explicit preferences, bug-fix root causes, and articulated reusable patterns. Never store secrets, credentials, tokens, PII, session summaries, progress reports, confirmations, speculative context, or attentiveness notes.

```javascript
mcp__memory__store_memory({
  content: "Brief title. Context + reasoning. Outcome.",
  type: "Decision",
  tags: ["<category>", "mcp-automem", "<language>"], // bare strings; NO platform tag, NO [YYYY-MM]
  importance: 0.85,
  confidence: 0.9
})
```

Use content of 150-300 chars when possible; put file paths, metrics, exit codes, and other structured details in `metadata`. For facts with a shelf life, use `t_valid` and `t_invalid` instead of date tags.

### Three mid-conversation triggers (and only three)

1. **User correction or override.** Listen for: "actually", "no, I prefer", "not X, Y", "that's wrong", "stop doing X", "never do X", "I told you before", "we decided X already". Store as `Preference`, importance 0.9, confidence 0.95, tag `correction`, then associate `INVALIDATED_BY` the prior memory.
2. **Decision stabilizes after at least one round of discussion.** Listen for: "let's go with X", "yeah that's the plan", "ship it", "do it that way", "final answer", "okay let's do that". Store as `Decision`, importance 0.85-0.9, then associate `PREFERS_OVER` alternatives if they came up.
3. **Pattern articulated - not inferred.** Listen for: "I always do X", "every time", "this is how I usually", "my thing is". Store as `Pattern`, importance 0.8, then associate concrete examples with `EXEMPLIFIES`.

### The atomic ritual - every store runs all four steps

```javascript
const related = await mcp__memory__recall_memory({ query: "<what is being corrected / decided / named>", limit: 5 })
const stored = await mcp__memory__store_memory({
  content: "Brief title. Context + reasoning. Outcome.",
  type: "Preference",
  tags: ["correction", "mcp-automem"],
  importance: 0.9,
  confidence: 0.95
})
await mcp__memory__recall_memory({ query: "<distinctive phrase from content>", limit: 3 })
if (related?.results?.length) {
  await mcp__memory__associate_memories({ memory1_id: related.results[0].id, memory2_id: stored.memory_id, type: "INVALIDATED_BY", strength: 0.9 })
}
```

Step 4 is where the graph gets built. Skipping it is the main reason AutoMem degrades into a flat bag of notes.

### Mandatory association pairings

| Trigger | Store as | Then associate |
|---|---|---|
| User correction | `Preference`, 0.9 / 0.95 | Old memory -> `INVALIDATED_BY` |
| Architectural decision | `Decision`, 0.9 / 0.9 | Alternatives -> `PREFERS_OVER` |
| Bug fix | `Insight`, 0.75 / 0.85, tags `bugfix` + `solution` | Bug report -> `LEADS_TO` |
| Pattern discovered | `Pattern`, 0.8 | Concrete examples -> `EXEMPLIFIES` |
| Knowledge evolved | `update_memory` old + store new | Old -> `EVOLVED_INTO` |
| Deprecated info | `update_memory` old with deprecated metadata | Old <- `INVALIDATED_BY` |

Prefer mcp__memory__update_memory over a duplicate store when a fact changes in place.
Valid relation types for mcp__memory__associate_memories: RELATES_TO, LEADS_TO, OCCURRED_BEFORE, PREFERS_OVER, EXEMPLIFIES, CONTRADICTS, REINFORCES, INVALIDATED_BY, EVOLVED_INTO, DERIVED_FROM, PART_OF.

## Guidelines

- Weave recalled context naturally; do not announce memory operations.
- Prefer high-signal memories: decisions, root causes, reusable patterns, and explicit preferences.
- Avoid wall-of-text memories; keep them atomic and focused.

## Memory vs current state

Recalled context is a prior, not ground truth. If a memory disagrees with the current repo state, the user's latest instruction, or a freshly read file - **current evidence wins**. Update or invalidate stale memory instead of acting on it.

If recall fails or returns nothing, continue without memory and do not mention the failure to the user. Weave recalled context naturally.

<!-- END AUTOMEM CODEX RULES -->

