# AutoMem + OpenClaw Integration Guide

Connect AutoMem (graph-vector memory) to **OpenClaw** with one of three supported modes:

1. `plugin` - recommended default for new installs
2. `mcp` - transparent `mcporter` setup using typed AutoMem tools
3. `skill` - legacy curl fallback

## Recommended mode order

### `plugin` (recommended)

- Native OpenClaw plugin with typed tools
- Uses the existing AutoMem HTTP client directly
- Ships its own `automem` skill and `before_agent_start` auto-recall hook
- Default auto-recall exposure is `dm-only`

```bash
npx @verygoodplugins/mcp-automem openclaw --mode plugin
```

### `mcp`

- Workspace/shared `automem` skill plus `mcporter` stdio server entry
- Uses the same typed AutoMem tool names as plugin mode
- Keeps secrets out of `mcporter.json`

```bash
npx @verygoodplugins/mcp-automem openclaw --mode mcp --workspace ~/clawd
```

### `skill`

- Legacy curl-only behavior for users who explicitly want the old setup
- Still installs workspace-local by default

```bash
npx @verygoodplugins/mcp-automem openclaw --mode skill --workspace ~/clawd
```

## Architecture by mode

### Plugin

```text
OpenClaw plugin -> AutoMem HTTP API
```

### MCP

```text
OpenClaw skill -> mcporter -> mcp-automem stdio server -> AutoMem HTTP API
```

### Legacy skill

```text
OpenClaw skill -> curl -> AutoMem HTTP API
```

## Memory layers

| Layer | Storage | Purpose | Scope |
| ----- | ------- | ------- | ----- |
| Daily files (`memory/YYYY-MM-DD.md`) | Local filesystem | Raw session logs | Single workspace |
| `MEMORY.md` / workspace notes | Local filesystem | Curated local notes | Single workspace |
| `memory-core` | OpenClaw file memory tools | Fast file-backed retrieval | Single workspace |
| AutoMem | FalkorDB + Qdrant | Semantic graph memory | Cross-session / cross-platform |

`memory-core` is complementary. AutoMem does not replace it.

## What the CLI does

`npx @verygoodplugins/mcp-automem openclaw` now supports these options:

```bash
npx @verygoodplugins/mcp-automem openclaw [options]

Options:
  --mode <plugin|mcp|skill>   Integration mode (default: plugin)
  --scope <workspace|shared>  Install scope for mcp/skill modes (default: workspace)
  --workspace <path>          OpenClaw workspace directory (auto-detected)
  --endpoint <url>            AutoMem endpoint (default: http://127.0.0.1:8001)
  --api-key <key>             AutoMem API key (optional)
  --plugin-source <spec>      npm spec or local path for plugin installs
  --name <name>               Project name used to seed default bare store tags
  --dry-run                   Preview changes without writing files
  --quiet                     Suppress non-error output
```

### In `plugin` mode

- Installs the package as an OpenClaw plugin
- Configures `plugins.entries.automem`
- Archives old `automem` skill overrides that would shadow the plugin-shipped skill
- Preserves old AGENTS cleanup only as a migration step
- Seeds bare project tags for stored memories only; auto-recall stays semantic and separately recalls `preference` memories first

### In `mcp` mode

- Installs the behavior-only `automem` skill into `<workspace>/skills/automem/` by default
- Creates `<workspace>/config/mcporter.json` by default
- Stores endpoint/api key in `skills.entries.automem.env/apiKey`
- Does not write secrets into `mcporter.json`
- Uses the same semantic-first recall guidance as plugin mode

### In `skill` mode

- Installs the legacy curl skill into `<workspace>/skills/automem/` by default
- Uses the same `skills.entries.automem.env/apiKey` convention
- Keeps bare-tag examples and semantic-first recall guidance even in curl mode

## Quick verification

After setup:

```bash
openclaw skills info automem
openclaw plugins list
mcporter list
```

What to expect:

- `plugin` mode: `openclaw plugins list` shows `automem`
- `mcp` mode: `mcporter list` shows `automem`
- `skill` mode: `openclaw skills info automem` shows the installed skill

## Troubleshooting

### AutoMem plugin not taking effect

1. Run `openclaw plugins list`
2. Restart the OpenClaw gateway
3. Check `~/.openclaw/openclaw.json` for `plugins.entries.automem`

### MCP mode tools are missing

1. Run `mcporter list`
2. Verify `<workspace>/config/mcporter.json` contains the `automem` server
3. Confirm `skills.entries.automem.env.AUTOMEM_ENDPOINT` is set in `~/.openclaw/openclaw.json`

### Legacy skill cannot reach AutoMem

1. Verify endpoint: `curl "$AUTOMEM_ENDPOINT/health"`
2. Check the API key if your AutoMem service is authenticated
3. Prefer `plugin` or `mcp` mode unless you explicitly need curl behavior

## Support

- OpenClaw Docs: <https://docs.openclaw.ai>
- AutoMem Repo: <https://github.com/verygoodplugins/mcp-automem>
- AutoMem Service: <https://github.com/verygoodplugins/automem>
