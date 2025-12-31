# AutoMem Plugin for Claude Code

Persistent memory for Claude Code via the AutoMem MCP server. Store decisions, patterns, and context across sessions.

## Installation

### From GitHub Marketplace

```bash
# In Claude Code:
/plugin marketplace add verygoodplugins/mcp-automem
/plugin install automem@verygoodplugins-mcp-automem
```

### Requirements

- AutoMem service running (see [main README](../../README.md))
- `AUTOMEM_ENDPOINT` environment variable set
- `AUTOMEM_API_KEY` if your AutoMem deployment requires auth

## What's Included

### Agent Skill: Memory Management

The plugin includes a **memory-management skill** that teaches Claude the 3-phase memory pattern:

1. **Session Start (Recall)** - Automatically recall project context
2. **During Work (Store)** - Store decisions, patterns, bug fixes
3. **Session End (Summarize)** - Store session summaries

### Slash Commands

| Command | Description |
|---------|-------------|
| `/memory-recall` | Search and recall relevant memories |
| `/memory-store` | Store an insight, decision, or pattern |
| `/memory-health` | Check AutoMem service status |

### SessionStart Hook

Automatically prompts memory recall at the beginning of each session.

### MCP Server

Configures the AutoMem MCP server with these tools:
- `store_memory` - Store memories with tags and importance
- `recall_memory` - Hybrid search (semantic + keyword + tags)
- `associate_memories` - Link related memories
- `update_memory` - Modify existing memories
- `delete_memory` - Remove memories
- `check_database_health` - Verify service status

## Configuration

Set the `AUTOMEM_ENDPOINT` environment variable:

```bash
# Local development
export AUTOMEM_ENDPOINT=http://127.0.0.1:8001

# Or in your shell profile
echo 'export AUTOMEM_ENDPOINT=http://127.0.0.1:8001' >> ~/.zshrc
```

If your AutoMem deployment requires authentication, also export `AUTOMEM_API_KEY`:

```bash
# Replace with your issued key
export AUTOMEM_API_KEY=your_api_key_here
```

## Memory Types

| Type | Importance | Use For |
|------|------------|---------|
| Decision | 0.9 | Architecture, library, pattern choices |
| Insight | 0.8 | Bug fixes, root causes, learnings |
| Pattern | 0.7 | Reusable approaches, best practices |
| Preference | 0.6-0.8 | User preferences, style choices |
| Context | 0.5-0.7 | Feature summaries, notes |

## Tagging Convention

Always include:

1. **Project name** - Primary identifier
2. **Component** - Specific area (auth, api, frontend)
3. **Type** - decision, bug-fix, pattern, feature
4. **Date** - YYYY-MM format

Example: `["myapp", "auth", "bug-fix", "2025-12"]`

## Alternative: NPX Installation

If you prefer the CLI approach instead of the plugin:

```bash
npx @verygoodplugins/mcp-automem claude-code
```

This installs the SessionStart hook and MCP permissions without the full plugin.

## More Information

- [AutoMem Documentation](../../README.md)
- [MCP Server on npm](https://www.npmjs.com/package/@verygoodplugins/mcp-automem)
- [AutoMem Service](https://github.com/verygoodplugins/automem)
