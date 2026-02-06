# AutoMem + OpenClaw Integration Guide

Connect AutoMem (graph-vector memory) to **OpenClaw**, the personal AI assistant with multi-platform messaging.

**Why add AutoMem to OpenClaw?**

- Your agent remembers decisions, patterns, and context across conversations
- Persistent memory survives gateway restarts
- Works across all OpenClaw channels (WhatsApp, Telegram, Slack, Discord, Signal, iMessage, Teams, etc.)
- Memory syncs across devices when using Railway backend
- Complements OpenClaw's file-based daily memory with semantic search

## Quick Start

```bash
# 1. Install behavioral rules into your OpenClaw workspace
npx @verygoodplugins/mcp-automem openclaw

# 2. Configure mcporter to reach AutoMem
mcporter config add automem \
  --command "npx" --arg "@verygoodplugins/mcp-automem" \
  --env "AUTOMEM_ENDPOINT=http://127.0.0.1:8001" \
  --scope home

# 3. Verify
mcporter list automem

# 4. Restart OpenClaw gateway
```

That's it. Your agent will now recall and store memories automatically.

## What the CLI Does

`npx @verygoodplugins/mcp-automem openclaw` performs these steps:

1. **Detects your OpenClaw workspace** (checks `~/.openclaw/workspace`, `~/clawd`, config files, or `--workspace` flag)
2. **Injects behavioral rules into `AGENTS.md`** — a marker-wrapped block that instructs the agent to proactively recall memories at session start and store important discoveries during conversation
3. **Updates `TOOLS.md`** with mcporter command reference for AutoMem tools
4. **Checks mcporter config** and prints setup instructions if AutoMem isn't configured yet

### CLI Options

```bash
npx @verygoodplugins/mcp-automem openclaw [options]

Options:
  --workspace <path>    OpenClaw workspace directory (auto-detected)
  --server <name>       mcporter server name (default: automem)
  --name <name>         Project name for memory tags (auto-detected)
  --dry-run             Show what would be changed without modifying files
  --quiet               Suppress output
```

### Re-running / Updating

The CLI is idempotent. Running it again will update the marker-wrapped block in `AGENTS.md` to the latest version without duplicating content. Backups are created before any modification.

## Architecture Overview

```
OpenClaw Agent
    ↓
mcporter (MCP CLI tool)
    ↓
AutoMem MCP Server
    ↓
AutoMem Backend Service
    (FalkorDB + Qdrant)
```

OpenClaw includes **mcporter** as a core skill — a CLI-based MCP client that calls external tools. AutoMem is an MCP-compatible server, so integration is configuration-only.

### Memory Layers

OpenClaw has three memory layers after integration:

| Layer                                | Storage           | Purpose                 | Scope                       |
| ------------------------------------ | ----------------- | ----------------------- | --------------------------- |
| Daily files (`memory/YYYY-MM-DD.md`) | Local filesystem  | Raw session logs        | Single workspace            |
| MEMORY.md                            | Local filesystem  | Curated long-term notes | Single workspace            |
| AutoMem                              | FalkorDB + Qdrant | Semantic graph memory   | All sessions, all platforms |

## Relationship with Built-in Memory Plugins

OpenClaw ships with a `memory-lancedb` plugin that provides `memory_search` and `memory_get` tools. These require OpenAI or Google API keys for embeddings.

**When AutoMem is configured, you do NOT need `memory-lancedb`:**

- AutoMem handles embeddings **server-side** — no OpenAI/Google API keys required on the client
- AutoMem provides the same functionality (and more) via mcporter: `recall_memory`, `store_memory`, `associate_memories`
- The bot may report `memory_search`/`memory_get` as "disabled" — this is expected and harmless
- The AGENTS.md rules explicitly tell the bot to use AutoMem instead

If you see messages like "memory tools are disabled" or "need API keys for memory," that refers to the built-in plugin, not AutoMem. AutoMem works independently.

## Prerequisites

1. **OpenClaw** installed (`2026.x` or later)

   ```bash
   # Recommended:
   curl -fsSL https://openclaw.ai/install.sh | bash
   # Or via npm:
   npm install -g openclaw@latest
   ```

2. **AutoMem service running**
   - **Local development** (fastest): `make dev` in automem repo → runs on `http://localhost:8001`
   - **Railway cloud** (recommended for production): One-click deploy with $5 free credits
   - **Self-hosted**: Docker or any container platform

3. **mcporter installed** (comes with OpenClaw, but verify):

   ```bash
   mcporter --version
   ```

## Step 1: Set Up AutoMem Backend

### Option A: Local Development (Fast, for Testing)

```bash
git clone https://github.com/verygoodplugins/automem.git
cd automem
make dev
```

Service runs at `http://localhost:8001` with no auth required.

### Option B: Railway Cloud (Recommended for Production)

[![Deploy on Railway](https://railway.com/button.svg)](https://railway.com/deploy/automem-ai-memory-service?referralCode=VuFE6g&utm_medium=integration&utm_source=template&utm_campaign=generic)

After deployment:

1. Note your Railway app URL (e.g., `https://automem-abc123.railway.app`)
2. If you set `AUTOMEM_API_TOKEN` in Railway, save it
3. Continue to Step 2

## Step 2: Configure mcporter

mcporter reads config from `~/.mcporter/mcporter.json` (user-level) or `./config/mcporter.json` (project-level).

### For local AutoMem (stdio via npx)

```bash
mcporter config add automem \
  --command "npx" --arg "@verygoodplugins/mcp-automem" \
  --env "AUTOMEM_ENDPOINT=http://127.0.0.1:8001" \
  --scope home \
  --description "AutoMem memory service"
```

### For Railway AutoMem (remote HTTP)

```bash
mcporter config add automem \
  https://your-sse-sidecar.railway.app/mcp \
  --transport http \
  --header "Authorization=Bearer YOUR_AUTOMEM_API_TOKEN" \
  --scope home \
  --description "AutoMem remote (Railway)"
```

Replace `your-sse-sidecar.railway.app` with your MCP sidecar Railway URL (not the raw AutoMem backend URL).

### Verify

```bash
mcporter list automem
```

Expected output:

```
automem - AutoMem memory service

  function store_memory(content: string, tags?: string[], ...): object;
  function recall_memory(query?: string, ...): object;
  function associate_memories(memory1_id: string, ...): object;
  function update_memory(memory_id: string, ...): object;
  function delete_memory(memory_id: string): object;
  function check_database_health(): object;

  6 tools · STDIO npx @verygoodplugins/mcp-automem
```

Use `mcporter list automem --schema` for full parameter documentation.

## Step 3: Install AutoMem Rules

```bash
npx @verygoodplugins/mcp-automem openclaw
```

Or with explicit workspace:

```bash
npx @verygoodplugins/mcp-automem openclaw --workspace ~/clawd
```

This injects behavioral rules into your agent's `AGENTS.md` that instruct it to:

- **Recall** relevant memories at the start of every session
- **Store** decisions, preferences, patterns, and insights during conversation
- **Associate** related memories to build a knowledge graph
- **Consolidate** daily file-based memory into AutoMem during heartbeats

## Step 4: Use AutoMem in Agent Sessions

Once configured, your agent will automatically use memory. You can also call tools directly:

### Health Check

```bash
mcporter call automem.check_database_health
```

### Store a Memory

```bash
mcporter call automem.store_memory \
  content="User prefers Claude for writing tasks" \
  importance:0.7 \
  tags='["preferences","ai-tools"]'
```

### Recall Memories

```bash
mcporter call automem.recall_memory \
  query="authentication patterns" \
  tags='["security","auth"]' \
  limit:10
```

### Update a Memory

```bash
mcporter call automem.update_memory \
  memory_id="<id-from-recall>" \
  importance:0.85 \
  tags='["critical","decision"]'
```

### Full API Reference

See [AutoMem Tools Reference](https://github.com/verygoodplugins/automem#tools) for complete parameter docs.

## Troubleshooting

### "mcporter: command not found"

Install mcporter globally:

```bash
npm install -g mcporter
```

### "Failed to reach AutoMem service"

**Check AutoMem is running:**

- Local: `curl http://127.0.0.1:8001/health`
- Railway: `curl https://your-railway-app.railway.app/health`

**Check mcporter config:**

```bash
mcporter config list
```

**Network issues:**

- VPN blocking? Whitelist Railway URL or use local AutoMem
- Firewall? Check port 8001 is accessible locally
- API token wrong? Regenerate in Railway settings

### "No tools found for automem"

Verify the server is responding:

```bash
mcporter list automem --schema
```

For debug output, add `--log-level debug` to see transport-level details.

### Agent Not Using Memory

1. Verify `AGENTS.md` contains the `<!-- BEGIN AUTOMEM OPENCLAW RULES -->` block
2. Restart the OpenClaw gateway after making changes
3. Check that mcporter can reach AutoMem: `mcporter call automem.check_database_health`
4. Look at agent logs for mcporter call output

### Bot Says "Memory Tools Disabled" or "Need API Keys"

This refers to OpenClaw's built-in `memory-lancedb` plugin, **not** AutoMem. AutoMem handles embeddings server-side — no client API keys needed.

**Fix:**
1. Verify `AGENTS.md` contains the AutoMem rules block (look for `<!-- BEGIN AUTOMEM OPENCLAW RULES -->`)
2. The rules explicitly tell the bot that `memory-lancedb` is NOT needed
3. Restart the gateway after updating AGENTS.md
4. On next session, the bot should run `mcporter call automem.check_database_health` and confirm memory is working

### Bot Says "AutoMem (mcporter) Isn't Installed"

mcporter is a bundled OpenClaw skill — it's already available. The bot may not realize it has access.

**Fix:**
1. Re-run `npx @verygoodplugins/mcp-automem openclaw` to get the latest template (v1.1.0+)
2. The updated rules explicitly state mcporter is a skill and how to use it
3. Restart gateway and send a test message

### Memories Not Persisting

**Local AutoMem**: Data lives in `~/.automem/data/` (FalkorDB). Check disk space.

**Railway AutoMem**:

- Verify persistent volume is mounted (check Railway dashboard)
- Check FalkorDB logs in Railway

## Performance Notes

- **Memory recall latency**: 50-200ms for typical queries (graph + vector search)
- **Bulk storage**: Batch multiple `store_memory` calls to reduce roundtrips
- **Cache warming**: Consider pre-loading common memories at gateway startup

## Next Steps

1. **Explore memory best practices**: [Memory Tagging & Organization](https://github.com/verygoodplugins/automem#memory-best-practices)
2. **Set up automated memory capture**: Use OpenClaw hooks to auto-store important events
3. **Share memories across devices**: Deploy Railway backend and sync across Mac, Windows, Linux
4. **Integrate with other tools**: mcporter supports 100+ other MCP servers

## Support

- **OpenClaw Docs**: <https://docs.openclaw.ai>
- **AutoMem Repo**: <https://github.com/verygoodplugins/automem>
- **OpenClaw Discord**: <https://discord.gg/clawd>
- **AutoMem Discord**: <https://automem.ai/discord>
