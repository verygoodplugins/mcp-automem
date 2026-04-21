# Deprecations

## Claude Code Plugin

The standalone Claude Code plugin shipped from this repository is **deprecated**.

### Status

- Deprecated in the current release line
- Still shipped for one compatibility release
- Planned removal: the release after the unified `install` workflow lands

### Why

`@verygoodplugins/mcp-automem` now treats the npm CLI as the canonical install channel for Claude Code and the rest of the supported clients. Keeping a separate plugin payload created duplicate copies of hooks, prompts, and helper scripts, which drifted from the canonical templates under `templates/`.

The repository direction is now:

- one repo
- one npm package
- one source of truth under `templates/`

### Recommended Path

Use the Claude Code CLI installer:

```bash
npx @verygoodplugins/mcp-automem claude-code
```

This is the supported Claude Code integration path until the unified `install` command lands.

### Migration for Existing Plugin Users

1. Remove the AutoMem plugin from Claude Code using the Claude Code plugin manager.
2. Run the supported installer:

```bash
npx @verygoodplugins/mcp-automem claude-code
```

3. Restart Claude Code.
4. Verify the `memory` MCP server tools are available and that `~/.claude/settings.json` contains the AutoMem MCP permissions.

If your old plugin install namespaced the MCP tool prefix, update any custom permissions or local notes to use the canonical `mcp__memory__*` tool names after migration.

### Scope of This Deprecation

Deprecated:

- Claude Code plugin installation via the marketplace payload in `plugins/automem`
- Claude Code plugin marketplace metadata in `.claude-plugin/marketplace.json`

Not deprecated:

- `npx @verygoodplugins/mcp-automem claude-code`
- manual/export-based setup for advanced users
- the Claude Code integration itself

### Follow-up

A follow-up branch will add:

- `npx @verygoodplugins/mcp-automem install`
- manifest-based install tracking
- `status`, `uninstall`, and `export` orchestration

After that lands, the deprecated Claude Code plugin payload will be removed.
