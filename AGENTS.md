# AGENTS.md

This file provides guidance to coding agents (Claude Code, Cursor, Codex, etc.) when working with code in this repository. It is the single source of truth; `CLAUDE.md` imports it via `@AGENTS.md`.

Migration note: if you previously had a local, gitignored `AGENTS.md`, delete it before pulling (or run `git clean -f AGENTS.md`) to avoid checkout/merge errors.

## Project Overview

**MCP AutoMem** is an MCP (Model Context Protocol) server that bridges AI assistants like Claude with the AutoMem memory service. It enables AI to store, recall, and associate memories using FalkorDB (graph database) and Qdrant (vector search).

**Core Purpose:**
- Translate MCP tool calls into AutoMem API requests
- Provide memory management for AI assistants (storage, hybrid search, relationships)
- Support Claude Code integration with session-recall and storage-nudge hooks

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

## Key Commands

### CLI Commands (via npx or global install)

```bash
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
    └── templates.ts      # Config snippet generation

templates/
├── claude-code/
│   ├── hooks/            # SessionStart recall prompt, Stop storage nudge, store tracker
│   └── settings.json     # Default hook config (merged into ~/.claude/settings.json)
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
   - **Ranked retrieval (default):** hybrid search across vector, keyword, tags, recency, and graph expansion. Supports `query`/`queries`, `embedding`, `limit`, `time_query`, `tags`, `tag_mode`, `tag_match`, `exclude_tags`, expansion options, context hints, and pagination (`offset`, `sort`, `format`). Responses are token-budgeted (default ~18k estimated tokens, override via `AUTOMEM_RECALL_TOKEN_BUDGET`) to stay under MCP client caps: `text`/`items`/`detailed` formats are summary-first (the stored summary replaces the content preview when present), relations collapse to `{id, type, strength, summary}` stubs, and metadata collapses to `metadata_keys`. `format: "json"` and ID fetches keep full per-field passthrough.
3. **associate_memories** — Create relationships (11 public authorable types only).
4. **update_memory** — Update existing memory fields (supports `MEMORY_TYPES` enum for `type`).
5. **delete_memory** — Two modes:
   - **Single (default):** `memory_id` → deletes one memory + its embedding.
   - **Bulk-by-tag:** `tags: [...]` → bulk-deletes ALL memories matching ANY tag (exact, case-insensitive). No dry-run; verify with `recall_memory({ tags, exhaustive: true })` first.
6. **check_database_health** — Check FalkorDB/Qdrant connection status.

**Note:** `search_by_tag` tool removed in v0.2.0; use `recall_memory` with `tags` parameter instead. The `get_memory`, `list_memories_by_tag`, `delete_memories_by_tag`, and `store_memories_batch` capabilities ship as parameter-extended modes on the tools above (per the global "Resist Tool Bloat" guidance) rather than as separate tools.

## Claude Code Integration

The `claude-code` command installs hooks built around LLM-judged storage — the model decides what is durable; hooks only prompt and observe, never write memories themselves:
- **SessionStart** (`automem-session-start.sh`): injects the two-phase recall prompt
- **PostToolUse** on `mcp__.*__store_memory` (`automem-track-store.sh`): writes a per-session sentinel recording that a store happened
- **Stop** (`automem-stop-nudge.sh`): if no store happened this session, emits `hookSpecificOutput.additionalContext` (with the required `hookEventName`) nudging Claude once to consider storing durable facts per the shared policy triggers. The JSON also sets top-level `suppressOutput: true` so the nudge is injected into Claude's context silently — it never prints to the user's terminal transcript.

The three installed hooks are pure bash+sed — the integration no longer requires Python or jq.

**Retired (auto-removed from existing installs on re-run, settings entries AND files):** the mechanical `capture-build-result.sh` / `capture-test-pattern.sh` / `capture-deployment.sh` PostToolUse hooks (templated "Build succeeded…" / "Deployed X to production…" one-liners were corpus noise that outranked real memories), the `session-memory.sh` Stop hook (#130) with its `process-session-memory.py` / `memory-filters.json` support chain, and the queue Stop machinery (`queue-cleanup.sh` + the npx queue drainer + `python-command.sh`) — nothing writes to the queue once the capture hooks are gone. `smart-notify.sh` is no longer shipped but is never removed from user machines.

**Modified Files:**
- `~/.claude/settings.json` - Merges tool permissions and hook configurations
- `~/.claude/hooks/*.sh` - Hook scripts (triggered by SessionStart, PostToolUse, Stop)

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
