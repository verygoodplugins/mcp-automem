# AutoMem Claude Code Integration

Canonical CLI-based integration guide for AutoMem with Claude Code.

## Philosophy

**Use the CLI installer as the supported path**

```bash
npx @verygoodplugins/mcp-automem claude-code
```

This installs the supported Claude Code integration from the repo's canonical `templates/claude-code/` assets.

The old Claude Code marketplace plugin is deprecated and kept only as a migration bridge for one release. See [DEPRECATION.md](../DEPRECATION.md).

Claude has direct MCP access and can judge what's worth storing better than low-signal automation alone. The supported integration provides:

1. **MCP permissions** - So Claude can use memory tools without asking
2. **SessionStart and capture hooks** - So recall/setup behavior stays consistent
3. **Memory rules** - Instructions in CLAUDE.md teaching Claude when to store/recall

The CLI installer is the source of truth. Manual config remains available below as an advanced fallback.

## Installation

### 1. Recommended Setup

Run:

```bash
npx @verygoodplugins/mcp-automem claude-code
```

This merges AutoMem permissions into `~/.claude/settings.json` and installs the canonical hook/support files under `~/.claude/`.

### 2. Advanced Manual Fallback

If you prefer to configure Claude Code by hand, use the manual steps below.

#### Add MCP Server

Add to `~/.claude.json`:

```json
{
  "mcpServers": {
    "memory": {
      "command": "npx",
      "args": ["-y", "@verygoodplugins/mcp-automem"],
      "env": {
        "AUTOMEM_ENDPOINT": "http://127.0.0.1:8001",
        "AUTOMEM_API_KEY": "your-api-key-if-required"
      }
    }
  }
}
```

#### Add Permissions (Optional)

To let Claude use memory tools without asking, add to `~/.claude/settings.json`:

> Note: The `mcp__memory__*` prefix assumes your MCP server is named `memory` (the key in `mcpServers`).
> Migration note: if you previously installed AutoMem via the deprecated Claude Code plugin, Claude may have namespaced the server name (for example `plugin_automem_memory`). After migrating to the CLI path, use the canonical `mcp__memory__*` tool names.

```json
{
  "permissions": {
    "allow": [
      "mcp__memory__store_memory",
      "mcp__memory__recall_memory",
      "mcp__memory__associate_memories",
      "mcp__memory__update_memory",
      "mcp__memory__delete_memory",
      "mcp__memory__check_database_health"
    ]
  }
}
```

Or use the canonical template:

```bash
cp templates/claude-code/settings.json ~/.claude/settings.json
```

#### Add Memory Rules

Append memory instructions to CLAUDE.md:

```bash
cat templates/CLAUDE_MD_MEMORY_RULES.md >> ~/.claude/CLAUDE.md
```

This teaches Claude:

- When to recall memories (session start, before decisions)
- What to store (decisions, patterns, insights, bug fixes)
- How to score importance (0.9+ critical, 0.7-0.8 important)
- How to create relationships between memories

### 3. Verify Installation

Ask Claude Code:

```text
Check the health of the AutoMem service
```

## How It Works

### Session Start

Claude automatically recalls:

- User preferences (Phase 1, tag-only, updated-first)
- Task context scoped to the current project (Phase 2, single semantic query, 90-day window)
- Similar errors/solutions on-demand when debugging (Phase 3)

### During Work

Claude stores significant events:

- Architecture decisions (importance: 0.9)
- Bug fixes with root cause (importance: 0.8)
- Patterns and insights (importance: 0.7)

## Available Tools

- `store_memory` - Save memories with tags, importance, metadata
- `recall_memory` - Hybrid search with graph expansion and context hints
- `associate_memories` - Create relationships (11 public authorable types)
- `update_memory` - Modify existing memories
- `delete_memory` - Remove memories
- `check_database_health` - Monitor service status

## Tips

1. **Use the CLI path for new installs** - It is the supported Claude Code integration.
2. **Manual config is fallback-only** - Keep it for advanced or locked-down environments.
3. **Keep memories concise** - Target 150-300 chars; max 500 chars (auto-summarized beyond that).
4. **Use bare tags** - Avoid platform tags and date tags in stored memories.
5. **Clean up** - Use `delete_memory` for outdated information.

## Troubleshooting

### Memories not storing

- Check MCP server is configured in `~/.claude.json`
- Verify AutoMem service is running: `curl $AUTOMEM_ENDPOINT/health`
- Check permissions in `~/.claude/settings.json`

### Recall not finding results

- Ensure memories are tagged with project name
- Try broader queries or fewer tag filters
- Check time range isn't too restrictive

## Learn More

- [Memory Rules Template](CLAUDE_MD_MEMORY_RULES.md) - Full instructions for Claude
- [AutoMem Documentation](https://github.com/verygoodplugins/automem) - Backend service
- [MCP Tools Reference](../INSTALLATION.md#mcp-tools) - All memory operations
- [Deprecations](../DEPRECATION.md) - Claude Code plugin migration and removal plan
