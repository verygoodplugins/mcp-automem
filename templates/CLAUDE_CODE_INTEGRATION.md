# AutoMem Claude Code Integration

Simple integration guide for AutoMem with Claude Code.

## Philosophy

**Trust Claude + good instructions > automated hooks**

Claude has direct MCP access and can judge what's worth storing better than automated capture hooks. This integration provides:

1. **MCP permissions** - So Claude can use memory tools without asking
2. **Memory rules** - Instructions in CLAUDE.md teaching Claude when to store/recall

No complex hook system, no queue processors, no background scripts.

## Installation

### 1. Add MCP Server

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

### 2. Add Permissions (Optional)

To let Claude use memory tools without asking, add to `~/.claude/settings.json`:

> Note: The `mcp__memory__*` prefix assumes your MCP server is named `memory` (the key in `mcpServers`).
> If you installed AutoMem via a Claude Code plugin, Claude may namespace the server name (e.g., `plugin_automem_memory`), which changes the tool names. Use the exact names shown in your tool list.

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

Or use our template:

```bash
cp templates/claude-code/settings.json ~/.claude/settings.json
```

### 3. Add Memory Rules

Append memory instructions to CLAUDE.md:

```bash
cat templates/CLAUDE_MD_MEMORY_RULES.md >> ~/.claude/CLAUDE.md
```

This teaches Claude:

- When to recall memories (session start, before decisions)
- What to store (decisions, patterns, insights, bug fixes)
- How to score importance (0.9+ critical, 0.7-0.8 important)
- How to create relationships between memories

## How It Works

### Session Start

Claude automatically recalls:

- Recent project context (last 7 days)
- User preferences and workflows
- Similar errors/solutions if debugging

### During Work

Claude stores significant events:

- Architecture decisions (importance: 0.9)
- Bug fixes with root cause (importance: 0.8)
- Patterns and insights (importance: 0.7)

### Session End

Claude summarizes if needed:

- Multiple files modified
- New features implemented
- Important decisions made

## Available Tools

- `store_memory` - Save memories with tags, importance, metadata
- `recall_memory` - Hybrid search with graph expansion and context hints
- `associate_memories` - Create relationships (11 types)
- `update_memory` - Modify existing memories
- `delete_memory` - Remove memories
- `check_database_health` - Monitor service status

## Tips

1. **Let Claude decide** - The memory rules guide Claude on what's worth storing
2. **Use project tags** - Always include project name in tags for filtering
3. **Keep memories concise** - Target 150-300 chars; max 500 chars (auto-summarized beyond that)
4. **Check periodically** - Ask "What do you remember about this project?"
5. **Clean up** - Use `delete_memory` for outdated information

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
