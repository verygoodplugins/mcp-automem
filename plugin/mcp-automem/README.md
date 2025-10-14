# AutoMem Plugin for Claude Code

Persistent memory system with automatic capture, intelligent recall, and knowledge graph building.

## Features

- 🧠 **Automatic Memory Capture** - Hooks that capture significant events (commits, builds, deployments, errors)
- 🔍 **Intelligent Recall** - Semantic search with hybrid vector + keyword + tag + recency scoring
- 🕸️ **Knowledge Graph** - 11 relationship types to connect related memories
- 🎯 **Smart Filtering** - Automatic significance scoring to reduce noise
- 📊 **Session Context** - Loads relevant memories at session start
- 🔗 **Cross-Platform** - Memories sync across Cursor, Claude Code, Codex, and Warp

## Installation

### Via Plugin Marketplace (Recommended)

```shell
# Add the Very Good Plugins marketplace
/plugin marketplace add verygoodplugins/claude-plugins

# Install AutoMem
/plugin install mcp-automem@verygoodplugins
```

### Via Local Marketplace (Development)

```shell
# Add local marketplace
/plugin marketplace add /path/to/plugin/parent/directory

# Install from local marketplace
/plugin install mcp-automem@local
```

## Quick Start

### 1. Check System Status

```shell
/automem-status
```

This verifies:
- AutoMem service connectivity
- Database health (FalkorDB + Qdrant)
- Recent memory activity
- Queue status

### 2. Recall Memories

```shell
/automem-recall
```

Intelligently loads relevant memories based on:
- Current project context
- Recently opened files
- Your specific query (optional)

### 3. Use the Memory Assistant

The plugin includes a specialized **Memory Assistant** agent for managing memories:

```shell
/agents
# Select "memory-assistant" from the list
```

The Memory Assistant can:
- Store new memories with proper classification
- Create relationships between memories
- Find and consolidate duplicate memories
- Update or delete outdated information

## What Gets Captured

### Default Captures (Minimal)

- **Git commits** - Commit context, changed files, diff stats
- **Build commands** - Success/failure, timing, errors
- **Session end** - Final session summary

### Optional Captures (Enable if needed)

The plugin supports additional capture hooks that are disabled by default:

- **Code edits** - Refactoring patterns, architectural changes
- **Test runs** - Test patterns, success/failure
- **Deployments** - Deployment records and status
- **Web searches** - Research findings and decisions
- **Error resolution** - Error patterns and solutions

To enable optional hooks, copy `hooks/hooks.extras.json` to `hooks/hooks.json` in the plugin directory.

## Commands

### `/automem-status`
Check AutoMem system health and recent activity.

### `/automem-recall`
Intelligently recall memories for current context.

### `/automem-queue`
Manually process the pending memory queue (normally automatic at session end).

## Architecture

```
┌─────────────────────────────────────┐
│      Claude Code Session             │
│   - User requests                    │
│   - Tool executions                  │
│   - Code changes                     │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│       Hook System (Plugin)           │
│   - PostToolUse (after tools)        │
│   - Stop (session end)               │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│    Memory Queue (memory-queue.jsonl) │
│   - Deduplicates                     │
│   - Scores importance                │
└──────────────┬──────────────────────┘
               │
               ▼ (session end)
┌─────────────────────────────────────┐
│    AutoMem Service (MCP)             │
│   - FalkorDB (graph)                 │
│   - Qdrant (vectors)                 │
│   - Enrichment pipeline              │
└──────────────────────────────────────┘
```

## File Structure

```
mcp-automem/
├── .claude-plugin/
│   ├── plugin.json        # Plugin metadata
│   └── .mcp.json         # MCP server config
├── commands/              # Slash commands
│   ├── automem-status.md
│   ├── automem-recall.md
│   └── automem-queue.md
├── agents/                # Specialized agents
│   └── memory-assistant.md
├── hooks/                 # Hook scripts
│   ├── hooks.json        # Default (minimal)
│   ├── hooks.extras.json # All captures
│   ├── session-memory.sh
│   ├── capture-build-result.sh
│   ├── capture-code-pattern.sh
│   ├── capture-deployment.sh
│   ├── capture-error-resolution.sh
│   ├── capture-search-result.sh
│   └── capture-test-pattern.sh
└── scripts/               # Support scripts
    ├── memory-filters.json
    ├── process-session-memory.py
    ├── queue-cleanup.sh
    ├── semantic-recall.py
    └── smart-notify.sh
```

## Configuration

### Environment Variables

The plugin uses these environment variables (configured in `.claude-plugin/.mcp.json`):

- `AUTOMEM_API_URL` - AutoMem service URL (default: `http://localhost:5050`)
- `OPENAI_API_KEY` - For semantic embeddings (optional, improves recall)

### Customizing Filters

Edit `scripts/memory-filters.json` to customize:
- Trivial patterns (files/changes to ignore)
- File weight multipliers (importance by file type)
- Significance keywords (boost importance)

### Adjusting Capture Threshold

In `scripts/process-session-memory.py`, modify `significance_threshold` (default: 8):
- Lower = more memories captured (noisier)
- Higher = fewer memories captured (higher signal)

## Troubleshooting

### Hooks Not Triggering

```bash
# Check plugin installation
/plugin

# Verify hook scripts are executable
ls -la {{PLUGIN_DIR}}/hooks/*.sh

# Test hook manually
CLAUDE_HOOK_TYPE=test bash {{PLUGIN_DIR}}/hooks/session-memory.sh
```

### Memories Not Storing

```bash
# Check AutoMem service
curl http://localhost:5050/health

# Check queue
cat ~/.claude/scripts/memory-queue.jsonl | wc -l

# Process queue manually
/automem-queue
```

### Service Not Running

```bash
# Start AutoMem service
docker run -p 5050:5050 verygoodplugins/automem

# Or use Railway/cloud deployment
# Update AUTOMEM_API_URL in .claude-plugin/.mcp.json
```

## Memory Types

The system classifies memories into 7 types:

- **Decision** - Strategic or technical decisions
- **Pattern** - Recurring approaches, best practices
- **Insight** - Key learnings, problem resolutions
- **Preference** - User/team preferences
- **Style** - Code style or formatting
- **Habit** - Regular behaviors or workflows
- **Context** - General information

## Relationship Types

Memories are connected via 11 relationship types:

- `RELATES_TO` - General connection
- `LEADS_TO` - Causal relationship (bug → solution)
- `OCCURRED_BEFORE` - Temporal sequence
- `PREFERS_OVER` - User preferences
- `EXEMPLIFIES` - Pattern examples
- `CONTRADICTS` - Conflicting approaches
- `REINFORCES` - Supporting evidence
- `INVALIDATED_BY` - Outdated information
- `EVOLVED_INTO` - Knowledge evolution
- `DERIVED_FROM` - Source relationships
- `PART_OF` - Hierarchical structure

## Support

- **GitHub**: [verygoodplugins/mcp-automem](https://github.com/verygoodplugins/mcp-automem)
- **Issues**: [GitHub Issues](https://github.com/verygoodplugins/mcp-automem/issues)
- **Documentation**: [Installation Guide](https://github.com/verygoodplugins/mcp-automem/blob/main/INSTALLATION.md)

## License

MIT License - see [LICENSE](https://github.com/verygoodplugins/mcp-automem/blob/main/LICENSE)

