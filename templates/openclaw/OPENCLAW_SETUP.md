# AutoMem + OpenClaw Integration Guide

Connect AutoMem (graph-vector memory) to **OpenClaw** with one of three supported modes:

1. `plugin` - recommended default for new installs
2. `mcp` - transparent `mcporter` setup using typed AutoMem tools
3. `skill` - legacy curl fallback

## Recommended mode order

### `plugin` (recommended)

- Happy path wrapper: `curl -fsSL https://automem.ai/install.sh | bash`
- Lean native OpenClaw plugin with typed tools
- Uses the existing AutoMem HTTP client directly
- Adds a `before_prompt_build` auto-recall hook
- Keeps `memory-core` selected as the active OpenClaw memory slot
- Default auto-recall exposure is `dm-only`
- On fresh installs, skips bootstrap only when AutoMem is already populated
- Hydrates a compact startup profile from AutoMem so the first chat can feel like a returning conversation

```bash
curl -fsSL https://automem.ai/install.sh | bash

# Local-build equivalent while developing this repo
./install.sh

# Raw CLI path when you need it
npx @verygoodplugins/mcp-automem openclaw --mode plugin
```

## What your AI is told

Once AutoMem is installed, OpenClaw prepends a short memory-policy block to every model call (invisibly — it lives in the system prompt, not in the chat). The policy is the same one shipped to Claude Desktop, Claude Code, Cursor, and Codex so your AI behaves consistently across tools.

**Recall** (automatic, no phrasing needed):

- **First substantive turn:** the AI pulls up your top 20 preferences and up to 30 project-scoped memories from the last 90 days, so it starts the conversation knowing who you are.
- **Mid-conversation:** it recalls again only when the topic shifts, a new proper noun shows up, you're actively debugging, or you explicitly ask ("what do you know about X?").
- **Routine follow-ups:** no extra recall — it relies on the conversation context and the memory it already loaded.

**Storage** (you trigger it by how you phrase things). The AI only persists a new memory when one of these three cues fires:

1. **You correct it.** Phrases: *"actually"*, *"no, I prefer"*, *"not X, Y"*, *"that's wrong"*, *"stop doing X"*, *"I told you before"*.
   → Stores a `Preference` (importance 0.9) and links it to the old memory with `INVALIDATED_BY`.
2. **A decision stabilizes after a round of discussion.** Phrases: *"let's go with X"*, *"yeah, that's the plan"*, *"ship it"*, *"do it that way"*, *"final answer"*.
   → Stores a `Decision` (importance 0.85–0.9) and links to any alternatives with `PREFERS_OVER`.
3. **You articulate a pattern.** Phrases: *"I always do X"*, *"every time"*, *"this is how I usually"*, *"my thing is"*.
   → Stores a `Pattern` (importance 0.8) and links concrete examples with `EXEMPLIFIES`.

Every store runs a four-step atomic ritual: recall related → store → re-recall to verify → associate. If you see the AI do "four tool calls to save one thing", that's why.

**Never stored** (keeps the memory graph clean): session summaries, attentiveness notes ("I'm listening"), speculative context, confirmations like *"great, that worked"*. Memory is for future-you, not performance.

**Relation types** (for your reference if you look at the graph): `RELATES_TO`, `LEADS_TO`, `OCCURRED_BEFORE`, `PREFERS_OVER`, `EXEMPLIFIES`, `CONTRADICTS`, `REINFORCES`, `INVALIDATED_BY`, `EVOLVED_INTO`, `DERIVED_FROM`, `PART_OF`.

Want to see the exact wording the AI sees? It's generated from `renderOpenClawPolicyContext()` in `src/memory-policy/shared.ts`.

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
  --replace-memory            Disable `memory-core`, disable the `session-memory` hook, and use AutoMem as the only memory system
  --dry-run                   Preview changes without writing files
  --quiet                     Suppress non-error output
```

### In `plugin` mode

- Installs a lean native plugin package staged inside `@verygoodplugins/mcp-automem`
- Configures `plugins.entries.automem`
- Enables the `/plugins` chat command for easier verification and troubleshooting
- Adds `automem` to `plugins.allow` only when the user already has a non-empty plugin allowlist
- Appends the six AutoMem tool names to `tools.alsoAllow` so they are added safely on top of restrictive base profiles such as `tools.profile: "coding"`
- Probes AutoMem health plus a lightweight recall on fresh installs and sets `agents.defaults.skipBootstrap = true` only when AutoMem is reachable and non-empty
- Hydrates `plugins.entries.automem.config.startupProfile` from memory-backed identity/personality cues when bootstrap is skipped
- Disables legacy `automem` skill entries and archives old overrides that would conflict with plugin mode
- Preserves old AGENTS cleanup only as a migration step
- Uses the shared AutoMem memory policy from Claude Desktop / Claude Code / Cursor: first-turn preference recall (`limit 20`), first-turn semantic task recall (`limit 30`, `last 90 days`), and debug-only bugfix recall (`tags: ["bugfix", "solution"]`)
- Keeps bare project tags for stores, while using `defaultTags` only as an unambiguous project gate for first-turn task recall
- Uses `defaultTags` only as an unambiguous project gate for first-turn task recall; later turns rely on the injected policy plus explicit tool calls instead of unconditional per-turn recall
- When bootstrap is skipped, the plugin injects the cached startup profile plus live startup recall on the first turn so OpenClaw greets like a returning conversation when possible, or falls back to a generic greeting without asking bootstrap questions again
- `--replace-memory` switches `plugins.slots.memory` to `"none"`, disables the bundled `session-memory` hook, and turns off `memory-core` dreaming so AutoMem is the only active memory layer

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

Onboarding behavior in `plugin` mode:

- populated AutoMem + fresh install: OpenClaw skips `BOOTSTRAP.md` and starts with memory-aware startup context
- empty or unreachable AutoMem: OpenClaw keeps the normal bootstrap flow
- existing workspaces with onboarding files: installer leaves bootstrap settings unchanged

Installer behavior:

- `install.sh` always chooses plugin mode for OpenClaw
- it restarts the gateway after config changes
- it verifies the plugin install and opens or prints the dashboard URL

## Scripted dogfood demo

Use this when you want to prove the clean-install flow end to end.

1. Reset OpenClaw:

```bash
openclaw reset --scope full --yes --non-interactive
```

1. Run the interactive installer:

```bash
./install.sh
```

1. Answer the prompts:

- `Do you want to install AutoMem to OpenClaw?` -> `y`
- `What is your AutoMem URL?` -> your populated AutoMem endpoint (the installer checks `/health` and warns if unreachable)
- `AutoMem API key (optional...)` -> paste key or press Enter if the endpoint is public
- `Replace OpenClaw's built-in memory with AutoMem? (Y|n)` -> `y` for most users

The installer will then restart the gateway, wait for it to come back healthy, verify the plugin registered, and print a final summary of what changed.

1. Verify the resulting setup:

```bash
openclaw plugins inspect automem --json
cat ~/.openclaw/openclaw.json
```

What to look for:

- `plugins.entries.automem`
- `commands.plugins: true`
- `agents.defaults.skipBootstrap: true` for a populated memory instance
- `plugins.entries.automem.config.startupProfile`

Expected browser-chat behavior on the next OpenClaw session:

- no `BOOTSTRAP.md` questionnaire
- memory and personality already loaded
- a normal returning greeting instead of name/timezone/vibe setup

## Troubleshooting

### AutoMem plugin not taking effect

1. Run `openclaw plugins list`
2. Restart the OpenClaw gateway
3. Check `~/.openclaw/openclaw.json` for `plugins.entries.automem`
4. Make sure `plugins.slots.memory` still points to `memory-core` if you want AutoMem as a complementary layer

### MCP mode tools are missing

1. Run `mcporter list`
2. Verify `<workspace>/config/mcporter.json` contains the `automem` server
3. Confirm `skills.entries.automem.env.AUTOMEM_API_URL` is set in `~/.openclaw/openclaw.json`

### Legacy skill cannot reach AutoMem

1. Verify endpoint: `curl "$AUTOMEM_API_URL/health"`
2. Check the API key if your AutoMem service is authenticated
3. Prefer `plugin` or `mcp` mode unless you explicitly need curl behavior

### Direct `openclaw plugins install @verygoodplugins/mcp-automem` fails

OpenClaw's native plugin safety gate evaluates the install target itself. The main `@verygoodplugins/mcp-automem` package includes broader CLI code, so plugin installs should go through:

```bash
npx @verygoodplugins/mcp-automem openclaw --mode plugin
```

This command installs the lean native plugin sidecar that ships inside the npm package.

## Support

- OpenClaw Docs: <https://docs.openclaw.ai>
- AutoMem Repo: <https://github.com/verygoodplugins/mcp-automem>
- AutoMem Service: <https://github.com/verygoodplugins/automem>
