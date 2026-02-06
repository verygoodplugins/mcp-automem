# AutoMem + OpenClaw Integration Guide

Connect AutoMem (graph-vector memory) to **OpenClaw**, the personal AI assistant with multi-platform messaging.

**Why add AutoMem to OpenClaw?**

- Your agent remembers decisions, patterns, and context across conversations
- Persistent memory survives gateway restarts
- Works across all OpenClaw channels (WhatsApp, Telegram, Slack, Discord, Signal, iMessage, Teams, etc.)
- Memory syncs across devices when using Railway backend

## Architecture Overview

**OpenClaw + mcporter + AutoMem flow:**

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

OpenClaw includes **mcporter** as a core skill—a CLI-based MCP client that calls external tools. AutoMem is an MCP-compatible server, so integration is configuration-only.

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

Best for getting started quickly or offline development.

```bash
git clone https://github.com/verygoodplugins/automem.git
cd automem
make dev
```

Service runs at `http://localhost:8001` with no auth required.

**For local OpenClaw dev on same machine**, skip to Step 2.

### Option B: Railway Cloud (Recommended for Production)

One-click deploy with persistent storage, team access, and always-on availability.

[![Deploy on Railway](https://railway.com/button.svg)](https://railway.com/deploy/automem-ai-memory-service?referralCode=VuFE6g&utm_medium=integration&utm_source=template&utm_campaign=generic)

After deployment:

1. Note your Railway app URL (e.g., `https://automem-abc123.railway.app`)
2. If you set `AUTOMEM_API_TOKEN` in Railway, save it
3. Continue to Step 2

**Cost estimate**: ~$0.50-1/month for light usage, or $5 free credits to start.

## Step 2: Configure mcporter

mcporter reads config from:

- **Project-level** (default): `./config/mcporter.json`
- **User-level**: `~/.mcporter/config.json` (use `--config` to override)
- **Windows**: `%USERPROFILE%\.mcporter\config.json`

### Step 2a: Initialize mcporter (if not already done)

```bash
mcporter config list
# If config doesn't exist, create it:
mkdir -p ~/.mcporter
touch ~/.mcporter/config.json
```

### Step 2b: Add AutoMem Server to mcporter

Edit `~/.mcporter/config.json`:

**For local AutoMem (stdio via npx):**

```json
{
  "servers": [
    {
      "id": "automem",
      "name": "AutoMem",
      "type": "stdio",
      "command": "npx @verygoodplugins/mcp-automem",
      "env": {
        "AUTOMEM_ENDPOINT": "http://127.0.0.1:8001"
      }
    }
  ]
}
```

**For Railway AutoMem (remote MCP via SSE sidecar):**

```json
{
  "servers": [
    {
      "id": "automem",
      "name": "AutoMem",
      "type": "http",
      "url": "https://your-sse-sidecar.railway.app/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_AUTOMEM_API_TOKEN"
      }
    }
  ]
}
```

Replace:

- `your-sse-sidecar.railway.app` with your SSE sidecar Railway URL
  (not the raw AutoMem backend URL)
- `YOUR_AUTOMEM_API_TOKEN` with your token (if you set one in Railway)

### Step 2c: Verify mcporter Can Reach AutoMem

```bash
mcporter list automem
```

Expected output:

```
✓ automem (stdio)
  - store_memory
  - recall_memory
  - associate_memories
  - update_memory
  - delete_memory
  - check_database_health
```

If you see an error, check:

1. AutoMem service is running (`http://localhost:8001/health` or Railway URL)
2. Network connectivity (firewall, VPN, etc.)
3. API token is correct (if using Railway with auth)

## Step 3: Use AutoMem in OpenClaw Agent

Once configured, your OpenClaw agent can call AutoMem tools via mcporter.

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

## Step 4: Integrate Memory into Agent Runs

### Option A: Automatic Recall via Agent Config

Enable AutoMem memory recall in your OpenClaw agent config (`~/.openclaw/openclaw.json`):

```json5
{
  agents: {
    list: [
      {
        name: 'default',
        systemPrompt: `
You are a helpful assistant with persistent memory.

At the START of each conversation:
1. Use mcporter to recall memories related to the current topic
2. Consider how past decisions and patterns apply

Before creating important content:
- Check memories for style preferences and past corrections
- Review relevant patterns from previous interactions

When you learn something important:
- Store it as a memory for future conversations
- Use tags to organize memories by topic
        `,
        skills: {
          allowBundled: ['mcporter'],
          entries: {
            mcporter: { enabled: true },
          },
        },
      },
    ],
  },
}
```

### Option B: Manual Memory Calls

In agent scripts or hooks, directly call mcporter:

```bash
# Recall memories about a topic
mcporter call automem.recall_memory \
  query="user's coding preferences" \
  limit:5 \
  --output json

# Store a memory
mcporter call automem.store_memory \
  content="User prefers functional programming style" \
  importance:0.8 \
  tags='["coding-style","preferences"]' \
  --output json
```

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
cat ~/.mcporter/config.json
```

**Network issues:**

- VPN blocking? Whitelist Railway URL or use local AutoMem
- Firewall? Check port 8001 is accessible locally
- API token wrong? Regenerate in Railway settings

### "No tools found for automem"

Verify the server is responding to MCP calls:

```bash
mcporter inspect automem
```

Should show tool schemas. If empty, AutoMem service isn't responding correctly.

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
