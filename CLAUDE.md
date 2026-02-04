# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**MCP AutoMem** is an MCP (Model Context Protocol) server that bridges AI assistants like Claude with the AutoMem memory service. It enables AI to store, recall, and associate memories using FalkorDB (graph database) and Qdrant (vector search).

**Core Purpose:**
- Translate MCP tool calls into AutoMem API requests
- Provide memory management for AI assistants (storage, hybrid search, relationships)
- Support Claude Code integration with automatic session capture hooks

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
npx @verygoodplugins/mcp-automem claude-code --profile lean      # Quiet defaults (recommended)
npx @verygoodplugins/mcp-automem claude-code --profile extras    # More hooks + status line
npx @verygoodplugins/mcp-automem claude-code --dry-run           # Preview changes
npx @verygoodplugins/mcp-automem claude-code --dir <path>        # Custom target directory

# Print config snippets for Claude Desktop/Cursor/Code
npx @verygoodplugins/mcp-automem config --format=json

# Process memory queue manually (normally automatic via Stop hook)
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

The server expects `AUTOMEM_ENDPOINT` (and optionally `AUTOMEM_API_KEY`) in environment or `.env` file.

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
│   ├── hooks/            # PostToolUse and Stop hook scripts
│   ├── scripts/          # Memory processing, filters, notifications
│   ├── settings.json     # Default hook config (merged into ~/.claude/settings.json)
│   └── profiles/
│       ├── settings.lean.json    # Quiet profile (recommended)
│       └── settings.extras.json  # Full-featured profile (optional)
├── CLAUDE_CODE_INTEGRATION.md   # Complete hook system documentation
└── CLAUDE_MD_MEMORY_RULES.md    # Memory rules template for ~/.claude/CLAUDE.md
```

## MCP Tools

The server exposes these tools to AI assistants:

1. **store_memory** - Store memory with content, tags, importance, metadata, embedding
2. **recall_memory** - Hybrid search (vector + keyword + tags + recency)
   - Supports `query`, `embedding`, `limit`, `time_query`, `tags`, `tag_mode`, `tag_match`
   - When `tags` provided: merges results from `/recall` and `/memory/by-tag` for better coverage
3. **associate_memories** - Create relationships (11 types: RELATES_TO, LEADS_TO, etc.)
4. **update_memory** - Update existing memory fields
5. **delete_memory** - Delete memory and embedding
6. **check_database_health** - Check FalkorDB/Qdrant connection status

**Note:** `search_by_tag` tool removed in v0.2.0; use `recall_memory` with `tags` parameter instead.

## Claude Code Integration

The `claude-code` command installs automation hooks that:
- Capture significant events (git commits, builds, deployments, errors)
- Queue memories in `~/.claude/scripts/memory-queue.jsonl`
- Drain queue to AutoMem service at session end (Stop hook)

**Modified Files:**
- `~/.claude/settings.json` - Merges tool permissions and hook configurations
- `~/.claude/hooks/*.sh` - Hook scripts (triggered by PostToolUse, Stop)
- `~/.claude/scripts/*` - Support scripts (queue processor, filters, notifications)

**Profiles:**
- **lean** (default): Quiet setup, high-signal hooks only (git commit, build, Stop)
- **extras**: Optional hooks (edit/test/deploy/search/error) + status line

**Key Implementation Details:**
- Hook matchers like `Bash(git commit*)` trigger `session-memory.sh`
- Queue processor (`npx mcp-automem queue`) reads JSONL entries and stores them via `store_memory`
- Relationships are optional: if a queue entry includes `relatesTo`, the processor creates that association; otherwise none are created automatically
- AutoMem enriches in background (entities, summaries, temporal links)

See `templates/CLAUDE_CODE_INTEGRATION.md` for complete architecture, hook system, troubleshooting.

## Environment Variables

```env
# Required: AutoMem service endpoint
# For local development:
AUTOMEM_ENDPOINT=http://127.0.0.1:8001
# Or for Railway deployment (your own instance):
AUTOMEM_ENDPOINT=https://your-automem-instance.railway.app

# Optional: API key for authenticated AutoMem instances
AUTOMEM_API_KEY=your_api_key_here
```

## Common Tasks

**Add a new MCP tool:**
1. Define tool schema in `tools` array in `src/index.ts` (with inputSchema)
2. Add handler in `CallToolRequestSchema` switch statement
3. Add corresponding method to `AutoMemClient` if API call needed
4. Update `src/types.ts` with new argument types

**Modify hook behavior:**
1. Edit hook scripts in `templates/claude-code/hooks/*.sh`
2. Update settings template in `templates/claude-code/settings.json`
3. Test with `--dry-run` flag before applying
4. Rebuild with `npm run build` if modifying TypeScript code

**Change memory filters:**
- Edit `templates/claude-code/scripts/memory-filters.json`
- Configure `trivial_patterns`, `significant_patterns`, `file_weight`, thresholds
- Users can customize `~/.claude/scripts/memory-filters.json` after installation

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

**Test queue processor:**
```bash
# Create test queue file
echo '{"content":"test memory","tags":["test"],"importance":0.5}' > /tmp/test-queue.jsonl

# Process it
npx @verygoodplugins/mcp-automem queue --file /tmp/test-queue.jsonl
```

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
- Hooks receive context via env vars. Capture scripts prefer `CLAUDE_LAST_COMMAND`, `CLAUDE_COMMAND_OUTPUT`, `CLAUDE_EXIT_CODE`, and fall back to `CLAUDE_CONTEXT`, `TOOL_NAME`, `TOOL_RESULT` when present.
- All hooks should be idempotent and safe to retry
- Use `memory-filters.json` to avoid storing trivial changes
- Queue format: JSONL (one JSON object per line)
- Template hook scripts in `templates/` are duplicated in `plugins/` for distribution; update both when changing hook behavior.

**Settings Merge Strategy:**
- `mergeSettings()` in `claude-code.ts` preserves existing configs
- Arrays merged via `mergeUniqueStrings()` (deduplicates)
- Hook entries merged via `mergeHookEntries()` (by matcher)
- Backups created automatically before modification

## Relationship Types (Memory Graph)

When using `associate_memories` tool:
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

## References

- AutoMem service: https://github.com/verygoodplugins/automem
- MCP specification: https://modelcontextprotocol.io/
- Full integration guide: `templates/CLAUDE_CODE_INTEGRATION.md`
- Memory rules template: `templates/CLAUDE_MD_MEMORY_RULES.md`
