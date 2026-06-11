# Deprecations

## Claude Code Plugin — deprecation REVERSED (June 2026)

The v0.14 deprecation of the Claude Code plugin has been **reversed**. The
plugin is now the recommended Claude Code install path, and the
`npx @verygoodplugins/mcp-automem claude-code` CLI installer is the
settings-level alternative.

### What changed

In April 2026 (v0.14) we deprecated the marketplace plugin in favor of the
CLI installer, because the duplicate plugin payload kept drifting from the
canonical `templates/`. Two things changed since:

1. The drift problem was solved by generation: the hook scripts in both
   `templates/claude-code/` and `plugins/automem/` are rendered from one
   policy source (`src/memory-policy/shared.ts`) and cannot diverge.
2. The Claude Code plugin system matured into the ecosystem-standard
   distribution channel: enable-time configuration prompts (`userConfig`,
   with keychain storage for secrets), automatic updates through the
   marketplace, and atomic uninstall. The CLI installer, by contrast, mutates
   user-owned `~/.claude/settings.json` and has needed several rounds of
   migration machinery to clean up after its own history.

### Current status

- **Recommended**: `/plugin marketplace add verygoodplugins/mcp-automem`,
  then `/plugin install automem@verygoodplugins-mcp-automem`
- **Supported alternative**: `npx @verygoodplugins/mcp-automem claude-code`
  (settings-level hooks + permissions; also the migration/cleanup path for
  older installs)
- Nothing is scheduled for removal.

### Migrating from the CLI install to the plugin

1. Remove the settings-level install so hooks don't fire twice and the
   memory tools don't appear under two servers:

```bash
npx @verygoodplugins/mcp-automem uninstall claude-code --clean-all
```

2. Install the plugin (commands above) and answer the API URL/key prompts.
3. Restart Claude Code.

Note: plugin MCP tools are namespaced (`mcp__plugin_automem_memory__*`), so
any custom permission rules or notes that reference `mcp__memory__*` should
be updated after migrating.

## Historical: `AUTOMEM_ENDPOINT`

`AUTOMEM_ENDPOINT` was renamed to `AUTOMEM_API_URL`. The old name is still
read as a fallback but warns at startup. Rename it in your environment.
