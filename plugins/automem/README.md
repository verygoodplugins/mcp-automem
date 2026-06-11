# AutoMem Plugin for Claude Code

Persistent memory for Claude Code via the AutoMem MCP server. This plugin is
the recommended way to install AutoMem in Claude Code: install and updates are
handled by Claude Code itself, configuration is prompted at enable time, and
uninstall is atomic.

## Installation

```bash
# In Claude Code:
/plugin marketplace add verygoodplugins/mcp-automem
/plugin install automem@verygoodplugins-mcp-automem
```

When you enable the plugin, Claude Code prompts for:

- **AutoMem API URL** — your service endpoint (e.g. `http://127.0.0.1:8001`
  or your Railway URL). Leave empty to use `AUTOMEM_API_URL` from your
  environment; falls back to `http://127.0.0.1:8001`.
- **AutoMem API key** — only if your deployment requires auth. Stored in the
  system keychain, never in `settings.json`.

### Requirements

- AutoMem service running (see [main README](../../README.md))
- Claude Code with plugin support

### Migrating from the CLI installer

If you previously ran `npx @verygoodplugins/mcp-automem claude-code`, remove
that install first so hooks don't fire twice and the memory tools don't appear
under two servers:

```bash
npx @verygoodplugins/mcp-automem uninstall claude-code --clean-all
```

Then install the plugin as above.

## What's Included

1. **Session Start (Recall)** — a SessionStart hook injects the two-phase
   recall prompt at the start of each session
2. **During Work (Store)** — Claude stores decisions, patterns, and fixes via
   the MCP tools as they stabilize; a PostToolUse hook tracks that a store
   happened
3. **Session End (Storage nudge)** — if nothing was stored, a Stop hook asks
   Claude once whether any durable facts emerged

The hooks are pure bash+sed — no Python or jq required.

### Slash Commands

| Command | Description |
|---------|-------------|
| `/memory-recall` | Search and recall relevant memories |
| `/memory-store` | Store an insight, decision, or pattern |
| `/memory-health` | Check AutoMem service status |

### MCP Server

The bundled MCP server provides: `store_memory`, `recall_memory`,
`associate_memories`, `update_memory`, `delete_memory`, and
`check_database_health`.

**Tool naming note:** Claude Code namespaces plugin MCP tools, so they appear
as `mcp__plugin_automem_memory__store_memory` (etc.) rather than
`mcp__memory__*`. You'll be asked to approve each tool on first use; to
pre-approve, add the `mcp__plugin_automem_memory__*` names to
`permissions.allow` in `~/.claude/settings.json`.

## Memory Types

| Type | Importance | Use For |
|------|------------|---------|
| Decision | 0.9 | Architecture, library, pattern choices |
| Insight | 0.8 | Bug fixes, root causes, learnings |
| Pattern | 0.7 | Reusable approaches, best practices |
| Preference | 0.6-0.8 | User preferences, style choices |
| Context | 0.5-0.7 | Feature summaries, notes |

## Tagging Convention

Use bare tags only:

1. **Project slug** when the memory is clearly project-scoped
2. **Category tags** like `decision`, `bugfix`, `deployment`, `test`
3. **Language tags** only when they add recall value

Do not use platform tags or date tags.

Example: `["mcp-automem", "bugfix", "typescript"]`

## Settings-Level Alternative

If you prefer hooks and permissions written directly into `~/.claude/`
(e.g. locked-down environments without plugin support):

```bash
npx @verygoodplugins/mcp-automem claude-code
```

See [INSTALLATION.md](../../INSTALLATION.md) for details.

## More Information

- [AutoMem Documentation](../../README.md)
- [MCP Server on npm](https://www.npmjs.com/package/@verygoodplugins/mcp-automem)
- [AutoMem Service](https://github.com/verygoodplugins/automem)
