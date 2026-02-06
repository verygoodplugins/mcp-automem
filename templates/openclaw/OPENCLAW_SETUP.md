# AutoMem + OpenClaw Integration Guide

Connect AutoMem (graph-vector memory) to **OpenClaw**, the personal AI assistant with multi-platform messaging.

**Why add AutoMem to OpenClaw?**

- Your agent remembers decisions, patterns, and context across conversations
- Persistent memory survives gateway restarts
- Works across all OpenClaw channels (WhatsApp, Telegram, Slack, Discord, Signal, iMessage, Teams, etc.)
- Memory syncs across devices when using Railway backend
- Complements OpenClaw's file-based daily memory with semantic search

## Architecture

```
Bot → bash curl → AutoMem HTTP API (FalkorDB + Qdrant)
```

The bot calls AutoMem's HTTP API directly via `curl` — simple, reliable, no extra dependencies.

### Memory Layers

| Layer | Storage | Purpose | Scope |
| ----- | ------- | ------- | ----- |
| Daily files (`memory/YYYY-MM-DD.md`) | Local filesystem | Raw session logs | Single workspace |
| MEMORY.md | Local filesystem | Curated long-term notes | Single workspace |
| AutoMem (skill) | FalkorDB + Qdrant | Semantic graph memory | All sessions, all platforms |

## Quick Start

```bash
# 1. Install the AutoMem skill + configure env vars
npx @verygoodplugins/mcp-automem openclaw --workspace ~/clawd

# 2. Restart OpenClaw gateway
```

That's it. The bot will now recall and store memories via `curl` calls to the AutoMem API.

## What the CLI Does

`npx @verygoodplugins/mcp-automem openclaw` performs these steps:

1. **Installs the AutoMem skill** to `~/.openclaw/skills/automem/SKILL.md` (user-level, shared across all workspaces)
2. **Configures env vars** in `~/.openclaw/openclaw.json` under `skills.entries.automem.env`
3. **Creates `memory/` directory** in the workspace (for daily file-based memory)
4. **Cleans up old AGENTS.md blocks** if present from previous installs

### CLI Options

```bash
npx @verygoodplugins/mcp-automem openclaw [options]

Options:
  --workspace <path>    OpenClaw workspace directory (auto-detected)
  --endpoint <url>      AutoMem endpoint (default: http://127.0.0.1:8001)
  --api-key <key>       AutoMem API key (optional, for authenticated instances)
  --name <name>         Project name for memory tags (auto-detected)
  --dry-run             Show what would be changed without modifying files
  --quiet               Suppress output
```

### Re-running / Updating

The CLI is idempotent. Running it again updates the skill file and config. Backups are created before any modification.

## Prerequisites

1. **OpenClaw** installed (`2026.x` or later)

   ```bash
   curl -fsSL https://openclaw.ai/install.sh | bash
   ```

2. **AutoMem service running**
   - **Local development**: `make dev` in automem repo (runs on `http://localhost:8001`)
   - **Railway cloud**: One-click deploy
   - **Self-hosted**: Docker or any container platform

## What Gets Installed

### Skill File

```
~/.openclaw/skills/automem/
└── SKILL.md
```

The skill teaches the bot to call AutoMem's HTTP API directly with `curl`. It includes:
- API reference (store, recall, associate, update, delete, health)
- Auth header handling (`$AUTOMEM_API_KEY` when set)
- Behavioral rules (when to recall, when to store, importance levels, tagging)
- Error handling (graceful fallback to file-based memory)

### Config Addition

In `~/.openclaw/openclaw.json`:

```json
{
  "skills": {
    "entries": {
      "automem": {
        "enabled": true,
        "env": {
          "AUTOMEM_ENDPOINT": "http://127.0.0.1:8001"
        }
      }
    }
  }
}
```

## Troubleshooting

### Agent Not Using Memory

1. Check that the skill is loaded: `openclaw skills check automem`
2. Restart the OpenClaw gateway after running the installer
3. Verify AutoMem is running: `curl http://127.0.0.1:8001/health`

### Bot Says "Memory Tools Disabled" or "Need API Keys"

This refers to OpenClaw's built-in `memory-lancedb` plugin, **not** AutoMem. AutoMem handles embeddings server-side — no client API keys required. The skill explicitly tells the bot to ignore this.

### curl Calls Failing

1. Verify endpoint: `curl $AUTOMEM_ENDPOINT/health`
2. Check API key if using authenticated instance
3. Check firewall/VPN for Railway endpoints

## Support

- **OpenClaw Docs**: <https://docs.openclaw.ai>
- **AutoMem Repo**: <https://github.com/verygoodplugins/automem>
- **OpenClaw Discord**: <https://discord.gg/clawd>
- **AutoMem Discord**: <https://automem.ai/discord>
