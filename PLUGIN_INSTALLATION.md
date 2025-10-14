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
   docker run -p 5050:5050 verygoodplugins/automem
   
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
# 1. Add the Very Good Plugins marketplace
/plugin marketplace add verygoodplugins/claude-plugins

# 2. Browse available plugins
/plugin

# 3. Select "Browse Plugins" and choose "mcp-automem"
# or install directly:
/plugin install mcp-automem@verygoodplugins
```

### Method 2: Via Local Directory (Development)

```shell
# 1. Clone the repository
git clone https://github.com/verygoodplugins/mcp-automem.git
cd mcp-automem

# 2. Add local marketplace
/plugin marketplace add ./plugin

# 3. Install from local marketplace
/plugin install mcp-automem@local
```

### Method 3: Via Git URL

```shell
# Add marketplace directly from Git URL
/plugin marketplace add https://github.com/verygoodplugins/mcp-automem.git#plugin

# Install plugin
/plugin install mcp-automem
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
/automem-status
```

You should see:
- ✅ AutoMem commands (`/automem-status`, `/automem-recall`, `/automem-queue`)
- ✅ Memory Assistant agent in `/agents`
- ✅ Hooks registered (visible in plugin details)

### 2. Test Memory Capture

```shell
# Make a git commit to trigger memory capture
git commit -m "Test memory capture"

# Check if memory was queued
cat ~/.claude/scripts/memory-queue.jsonl
```

### 3. Try Memory Recall

```shell
# Recall memories for current project
/automem-recall

# Or ask the Memory Assistant
/agents
# Select "memory-assistant"
# Ask: "What do you remember about this project?"
```

## Configuration

### Update AutoMem Service URL

If using cloud deployment, update the service URL:

1. **Find plugin directory:**
   ```shell
   # Plugin installed at:
   ~/.claude/plugins/mcp-automem@marketplace-name/
   ```

2. **Edit `.claude-plugin/.mcp.json`:**
   ```json
   {
     "mcpServers": {
       "memory": {
         "command": "npx",
         "args": ["-y", "@verygoodplugins/mcp-automem"],
         "env": {
           "AUTOMEM_API_URL": "https://your-instance.railway.app"
         }
       }
     }
   }
   ```

3. **Restart Claude Code** to apply changes.

### Enable Additional Capture Hooks

The plugin installs with minimal hooks by default (git commits, builds). To enable all captures:

1. **Navigate to plugin directory:**
   ```shell
   cd ~/.claude/plugins/mcp-automem@marketplace-name/hooks/
   ```

2. **Replace hooks config:**
   ```shell
   cp hooks.extras.json hooks.json
   ```

3. **Restart Claude Code** to load new hooks.

This enables captures for:
- Code edits (`Edit`, `MultiEdit`)
- Test runs (`*test*`)
- Deployments (`*deploy*`)
- Web searches (`WebSearch`)
- Error resolution (`*error*`)

### Customize Memory Filters

Edit `scripts/memory-filters.json` to adjust:

```json
{
  "trivial_patterns": [
    ".DS_Store",
    "node_modules/",
    "*.lock"
  ],
  "file_weight": {
    ".py": 2.0,
    ".js": 2.0,
    ".ts": 2.0
  },
  "significance_keywords": {
    "BREAKING": 5,
    "feat:": 3,
    "fix:": 3
  }
}
```

## Usage

### Commands

#### `/automem-status`
Check system health and recent activity:
```
🧠 AutoMem Status
==================

System Health: ✓ Connected
- Graph DB: FalkorDB (healthy)
- Vector Store: Qdrant (healthy)

Today's Activity:
- Memories stored: 12
- Decisions: 3
- Patterns: 2
- Bug fixes: 4

Queue: 0 pending
```

#### `/automem-recall`
Intelligent context-aware recall:
- Analyzes current working directory
- Examines recently opened files
- Executes parallel recall strategies
- Presents relevant memories with relationships

#### `/automem-queue`
Manually process pending memories:
- Useful for testing during development
- Forces queue processing without ending session
- Reports results and any errors

### Memory Assistant Agent

Access via `/agents` → "memory-assistant"

**Capabilities:**
- Store memories with proper classification
- Create relationships between memories
- Find and consolidate duplicates
- Update or delete outdated information
- Proactive context loading

**Example interactions:**
```
You: "What do you remember about authentication in this project?"
Agent: *recalls auth-related memories, presents timeline of decisions*

You: "Store this as a pattern we use"
Agent: *stores with type=Pattern, links to related memories*

You: "Find duplicate memories about JWT"
Agent: *searches, identifies duplicates, offers to consolidate*
```

### Automatic Memory Capture

The plugin automatically captures:

**Default (Minimal):**
- Git commits with context
- Build results (success/failure)
- Session summaries

**Optional (Enable manually):**
- Code patterns from edits
- Test execution results
- Deployment records
- Web search findings
- Error resolutions

All captures are:
- ✅ Deduplicated by content hash
- ✅ Scored for importance (0.0-1.0)
- ✅ Filtered for significance (threshold: 8)
- ✅ Tagged consistently (project, component, type, date)
- ✅ Enriched with metadata

## Troubleshooting

### Plugin Not Showing Commands

**Issue:** Commands don't appear in `/help` after installation.

**Solution:**
```shell
# 1. Verify plugin is installed
/plugin
# Should show "mcp-automem" as installed

# 2. Restart Claude Code
# Exit and restart

# 3. Check plugin directory exists
ls ~/.claude/plugins/mcp-automem@*/
```

### Hooks Not Triggering

**Issue:** Memory capture not happening on git commits or builds.

**Solution:**
```shell
# 1. Check hooks are registered
/plugin
# View plugin details → should show hooks

# 2. Verify scripts are executable
ls -la ~/.claude/plugins/mcp-automem@*/hooks/*.sh
# Should show -rwxr-xr-x permissions

# 3. Test hook manually
cd ~/.claude/plugins/mcp-automem@*/
CLAUDE_HOOK_TYPE=test bash hooks/session-memory.sh

# 4. Check logs
tail -f ~/.claude/logs/session-memory.log
```

### AutoMem Service Unreachable

**Issue:** `/automem-status` shows service unreachable.

**Solution:**
```shell
# 1. Check service is running
curl http://localhost:5050/health

# 2. If local Docker:
docker ps | grep automem
# If not running:
docker run -p 5050:5050 verygoodplugins/automem

# 3. If cloud deployment, verify URL in .mcp.json:
cat ~/.claude/plugins/mcp-automem@*/.claude-plugin/.mcp.json
# Update AUTOMEM_API_URL if needed

# 4. Restart Claude Code after URL change
```

### Memories Not Storing

**Issue:** Queue has entries but memories aren't in AutoMem.

**Solution:**
```shell
# 1. Check queue file
cat ~/.claude/scripts/memory-queue.jsonl
wc -l ~/.claude/scripts/memory-queue.jsonl

# 2. Process queue manually
/automem-queue

# 3. Check service logs for errors
# If Docker:
docker logs <container-id>

# 4. Verify MCP tools are allowed
# Should be automatic with plugin, but check:
# ~/.claude/settings.json should include mcp__memory__* permissions
```

### Queue Growing Too Large

**Issue:** Queue file has hundreds of entries.

**Solution:**
```shell
# 1. Check queue size
wc -l ~/.claude/scripts/memory-queue.jsonl

# 2. Queue cleanup runs automatically at session end
# Force cleanup now:
cd ~/.claude/plugins/mcp-automem@*/
bash scripts/queue-cleanup.sh

# 3. Process cleaned queue
/automem-queue

# 4. If still large, increase significance threshold
# Edit scripts/process-session-memory.py
# Change: significance_threshold = 8
# To: significance_threshold = 10  (captures less)
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
rm ~/.claude/hooks/session-memory.sh
rm ~/.claude/hooks/capture-*.sh

# Keep queue file and logs - plugin will use them
# Do NOT delete:
# - ~/.claude/scripts/memory-queue.jsonl
# - ~/.claude/logs/
```

### Step 3: Install Plugin

```shell
# Install plugin
/plugin marketplace add verygoodplugins/claude-plugins
/plugin install mcp-automem@verygoodplugins
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
/automem-status

# Make a test commit
git commit --allow-empty -m "Test plugin hooks"

# Check queue
cat ~/.claude/scripts/memory-queue.jsonl
```

## Plugin Structure Reference

```
~/.claude/plugins/mcp-automem@marketplace-name/
├── .claude-plugin/
│   ├── plugin.json          # Plugin metadata
│   └── .mcp.json           # MCP server config (edit for URL)
├── commands/                # Slash commands
│   ├── automem-status.md
│   ├── automem-recall.md
│   └── automem-queue.md
├── agents/                  # Specialized agents
│   └── memory-assistant.md
├── hooks/                   # Hook configurations
│   ├── hooks.json          # Active hooks (default: minimal)
│   ├── hooks.extras.json   # All hooks (copy to hooks.json to enable)
│   └── *.sh                # Hook scripts
└── scripts/                 # Support scripts
    ├── memory-filters.json # Customize filters here
    ├── process-session-memory.py
    ├── queue-cleanup.sh
    ├── semantic-recall.py
    └── smart-notify.sh
```

## Next Steps

- **Read the main README** in the plugin directory for detailed architecture
- **Try the Memory Assistant** agent for interactive memory management
- **Review captured memories** using `/automem-recall`
- **Customize filters** in `scripts/memory-filters.json` for your workflow
- **Enable extra hooks** if you want more comprehensive capture

## Support

- **GitHub**: [verygoodplugins/mcp-automem](https://github.com/verygoodplugins/mcp-automem)
- **Issues**: [GitHub Issues](https://github.com/verygoodplugins/mcp-automem/issues)
- **Email**: support@verygoodplugins.com

## See Also

- [Main Installation Guide](INSTALLATION.md) - NPX-based installation
- [Claude Code Integration](templates/CLAUDE_CODE_INTEGRATION.md) - Technical details
- [AutoMem Service](https://github.com/verygoodplugins/automem) - Core service
- [MCP Documentation](https://modelcontextprotocol.io/) - MCP specification

