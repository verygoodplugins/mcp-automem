# AutoMem Plugin Installation for Claude Code

This guide covers installing AutoMem as a native Claude Code plugin for a seamless, integrated experience.

## Table of Contents

- [Overview](#overview)
- [Prerequisites](#prerequisites)
- [Installation Methods](#installation-methods)
- [Quick Start](#quick-start)
- [Configuration](#configuration)
- [Usage](#usage)
- [Troubleshooting](#troubleshooting)
- [Migration from NPX Setup](#migration-from-npx-setup)

## Overview

AutoMem is available as a Claude Code plugin, providing:

- **Native Integration** - Automatically registers hooks, commands, and agents
- **Easy Installation** - One command via Claude Code's plugin system
- **Automatic Updates** - Plugin system manages versioning
- **Self-Contained** - All paths relative to plugin directory
- **Better Discovery** - Browse and manage via `/plugin` menu

## Prerequisites

### Required

1. **Claude Code** installed and running
2. **AutoMem Service** running locally or via cloud:
   ```bash
   # Option A: Docker (local)
   docker run -p 8001:8001 verygoodplugins/automem
   
   # Option B: Railway (cloud)
   # Deploy from https://github.com/verygoodplugins/automem
   # Get your deployment URL
   ```

### Optional but Recommended

3. **OpenAI API Key** for enhanced semantic search:
   ```bash
   export OPENAI_API_KEY="sk-..."
   ```

## Installation Methods

### Method 1: Via GitHub Marketplace (Recommended)

```shell
# 1. Add the AutoMem marketplace
/plugin marketplace add verygoodplugins/mcp-automem

# 2. Browse available plugins
/plugin

# 3. Select "Browse Plugins" and choose "automem"
# or install directly:
/plugin install automem@verygoodplugins-mcp-automem
```

### Method 2: Via Local Directory (Development)

```shell
# 1. Clone the repository
git clone https://github.com/verygoodplugins/mcp-automem.git
cd mcp-automem

# 2. Add local marketplace
/plugin marketplace add .

# 3. Install from local marketplace
/plugin install automem@local
```

### Method 3: Via Git URL

```shell
# Add marketplace directly from Git URL
/plugin marketplace add https://github.com/verygoodplugins/mcp-automem.git

# Install plugin
/plugin install automem@verygoodplugins-mcp-automem
```

## Quick Start

### 1. Verify Installation

After installing, restart Claude Code and verify:

```shell
# Check plugin status
/plugin

# View new commands
/help

# Check system health
/memory-health
```

You should see:
- ✅ AutoMem commands (`/memory-health`, `/memory-recall`, `/memory-store`)
- ✅ Memory management skill available in `/skills`
- ✅ SessionStart hook registered (visible in plugin details)

### 2. Try Memory Recall

```shell
# Recall memories for current project
/memory-recall
```

### 3. Store a Memory

```shell
# Store a decision, insight, or pattern
/memory-store
```

## Configuration

### Update AutoMem Service URL

If using cloud deployment, update the service URL:

1. **Find plugin directory:**
   ```shell
   # Plugin installed at:
   ~/.claude/plugins/automem@marketplace-name/
   ```

2. **Edit `.claude-plugin/.mcp.json`:**
   ```json
   {
     "mcpServers": {
       "memory": {
         "command": "npx",
         "args": ["-y", "@verygoodplugins/mcp-automem"],
         "env": {
           "AUTOMEM_ENDPOINT": "https://your-instance.railway.app"
         }
       }
     }
   }
   ```

3. **Restart Claude Code** to apply changes.

### SessionStart Hook

The plugin registers a SessionStart hook that prompts a memory recall at the
beginning of each Claude Code session.

## Usage

### Commands

#### `/memory-health`
Check AutoMem service health and connectivity.

#### `/memory-recall`
Intelligent context-aware recall:
- Analyzes current working directory
- Examines recently opened files
- Executes parallel recall strategies
- Presents relevant memories with relationships

#### `/memory-store`
Store a decision, insight, or pattern with tags and importance.

### SessionStart Recall

On session start, the plugin prompts a recall using the memory-management skill
to load recent and relevant project context.

## Troubleshooting

### Plugin Not Showing Commands

**Issue:** Commands don't appear in `/help` after installation.

**Solution:**
```shell
# 1. Verify plugin is installed
/plugin
# Should show "automem" as installed

# 2. Restart Claude Code
# Exit and restart

# 3. Check plugin directory exists
ls ~/.claude/plugins/automem@*/
```

### SessionStart Recall Not Triggering

**Issue:** Memory recall prompt doesn't appear at session start.

**Solution:**
```shell
# 1. Check hooks are registered
/plugin
# View plugin details → should show hooks

# 2. Verify script is executable
ls -la ~/.claude/plugins/automem@*/scripts/session-start.sh
# Should show -rwxr-xr-x permissions

# 3. Test hook manually
cd ~/.claude/plugins/automem@*/
bash scripts/session-start.sh

```

### AutoMem Service Unreachable

**Issue:** `/memory-health` shows service unreachable.

**Solution:**
```shell
# 1. Check service is running
curl http://127.0.0.1:8001/health

# 2. If local Docker:
docker ps | grep automem
# If not running:
docker run -p 8001:8001 verygoodplugins/automem

# 3. If cloud deployment, verify URL in .mcp.json:
cat ~/.claude/plugins/automem@*/.claude-plugin/.mcp.json
# Update AUTOMEM_ENDPOINT if needed

# 4. Restart Claude Code after URL change
```

### Memories Not Storing

**Issue:** `/memory-store` runs but memories don't appear in AutoMem.

**Solution:**
```shell
# 1. Check service health
curl http://127.0.0.1:8001/health

# 2. Verify endpoint config
cat ~/.claude/plugins/automem@*/.claude-plugin/.mcp.json

# 3. Check service logs for errors
# If Docker:
docker logs <container-id>

# 4. Verify MCP tools are allowed
# Should be automatic with plugin, but check:
# ~/.claude/settings.json should include mcp__memory__* permissions
```

## Migration from NPX Setup

If you previously installed AutoMem via `npx @verygoodplugins/mcp-automem claude-code`, you can migrate to the plugin:

### Step 1: Backup Current Setup

```bash
# Backup current settings
cp ~/.claude/settings.json ~/.claude/settings.json.pre-plugin

# Backup hooks and scripts
cp -r ~/.claude/hooks ~/.claude/hooks.backup
cp -r ~/.claude/scripts ~/.claude/scripts.backup
```

### Step 2: Clean NPX Installation

```bash
# Remove NPX-installed hooks (optional)
# The plugin will override these, but you can clean them:
rm ~/.claude/hooks/automem-*.sh
```

### Step 3: Install Plugin

```shell
# Install plugin
/plugin marketplace add verygoodplugins/mcp-automem
/plugin install automem@verygoodplugins-mcp-automem
```

### Step 4: Update Settings

The plugin handles most configuration automatically, but review:

```bash
# Compare settings
diff ~/.claude/settings.json.pre-plugin ~/.claude/settings.json

# Plugin should have merged permissions correctly
# Verify mcp__memory__* permissions are present
```

### Step 5: Clean Up Old Settings

**Optional:** Remove old hook configurations from `~/.claude/settings.json`:

The plugin's hooks take precedence, so old NPX hook configs can be removed if you prefer a cleaner settings file.

### Step 6: Test

```shell
# Restart Claude Code

# Verify everything works
/memory-health

# Try a recall
/memory-recall
```

## Plugin Structure Reference

```
~/.claude/plugins/automem@marketplace-name/
├── .claude-plugin/
│   └── plugin.json          # Plugin metadata
├── .mcp.json                # MCP server config (root reference)
├── commands/                # Slash commands
│   ├── memory-health.md
│   ├── memory-recall.md
│   └── memory-store.md
├── hooks/                   # Hook configurations
│   └── hooks.json
├── scripts/                 # Support scripts
│   └── session-start.sh
└── skills/
    └── memory-management/
        ├── SKILL.md
        └── patterns.md
```

## Next Steps

- **Read the plugin README** for detailed usage and examples
- **Try recall and store** using `/memory-recall` and `/memory-store`
- **Review the memory-management skill** for tagging and recall patterns

## Support

- **GitHub**: [verygoodplugins/mcp-automem](https://github.com/verygoodplugins/mcp-automem)
- **Issues**: [GitHub Issues](https://github.com/verygoodplugins/mcp-automem/issues)
- **Email**: support@verygoodplugins.com

## See Also

- [Main Installation Guide](INSTALLATION.md) - NPX-based installation
- [Claude Code Integration](templates/CLAUDE_CODE_INTEGRATION.md) - Technical details
- [AutoMem Service](https://github.com/verygoodplugins/automem) - Core service
- [MCP Documentation](https://modelcontextprotocol.io/) - MCP specification
