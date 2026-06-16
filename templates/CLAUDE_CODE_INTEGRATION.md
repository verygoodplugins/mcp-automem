# AutoMem Claude Code Integration

Canonical integration guide for AutoMem with Claude Code.

## Philosophy

Claude has direct MCP access and can judge what's worth storing better than low-signal automation alone. The integration provides, in any install mode:

1. **The AutoMem MCP server** - memory tools wired into Claude Code
2. **SessionStart recall + Stop storage-nudge hooks** - So recall happens every session and storage stays LLM-judged (hooks prompt and observe; they never write memories themselves)
3. **Memory rules** - Instructions in CLAUDE.md teaching Claude when to store/recall

Both install modes ship the same policy-generated hook scripts, so behavior is identical; they differ only in where the wiring lives.

## Installation

### 1. Plugin (Recommended)

```text
# In Claude Code:
/plugin marketplace add verygoodplugins/mcp-automem
/plugin install automem@verygoodplugins-mcp-automem
```

Claude Code prompts for your AutoMem API URL and (optional) API key at enable time, bundles the MCP server and hooks, auto-updates through the marketplace, and uninstalls atomically.

> Tool naming: plugin MCP tools are namespaced as `mcp__plugin_automem_memory__*` rather than `mcp__memory__*`. Approve them on first use, or pre-approve those names in `permissions.allow`.

Migrating from the CLI installer? Remove the settings-level install first (`npx @verygoodplugins/mcp-automem uninstall claude-code --clean-all`) so hooks don't fire twice.

### 2. CLI Installer (settings-level alternative)

```bash
npx @verygoodplugins/mcp-automem claude-code
```

For environments without plugin support, or when you want the hooks and permissions written directly into `~/.claude/`. This merges the six `mcp__memory__*` permissions and the default silent hook registrations into `~/.claude/settings.json` and installs the canonical hook scripts from `templates/claude-code/` — nothing else (no `Bash(*)` grants, no deny/ask blocks). Re-running it migrates legacy installs: retired hooks, retired script files, and the retired hook-era `Bash(python*/jq)` permission grants are removed automatically.

Windows compatibility for either mode is limited to POSIX shell environments such as Git Bash, MSYS2, or WSL. Only `bash` must be available — the hooks are pure bash+sed, with no Python or jq dependency. This is not full native Windows hook support.

### 3. Advanced Manual Fallback

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
        "AUTOMEM_API_URL": "http://127.0.0.1:8001",
        "AUTOMEM_API_KEY": "your-api-key-if-required"
      }
    }
  }
}
```

#### Add Permissions (Optional)

To let Claude use memory tools without asking, add to `~/.claude/settings.json`:

> Note: The `mcp__memory__*` prefix assumes your MCP server is named `memory` (the key in `mcpServers`).
> Migration note: plugin installs namespace the server name (`plugin_automem_memory`), so plugin tools are `mcp__plugin_automem_memory__*`. The `mcp__memory__*` names below apply to user-level installs where the `mcpServers` key is `memory`. Use whichever prefix matches your install mode.

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

### 4. Verify Installation

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

Claude stores significant events as they stabilize (per the memory rules):

- Architecture decisions (importance: 0.9)
- Bug fixes with root cause (importance: 0.8)
- Patterns and insights (importance: 0.7)

### Session End

The default Claude Code integration is silent at session end. SessionStart
guidance tells Claude to store, verify, and associate durable memories during
normal work when the trigger fires; the PostToolUse tracker observes whether
`store_memory` was called, but no default Stop hook injects feedback into the
chat stream.

The optional `automem-stop-nudge.sh` Stop hook still ships for users who
prefer an explicit end-of-session reminder. It is registered only by the CLI
installer's nudged profile:

```bash
npx @verygoodplugins/mcp-automem claude-code --profile nudged
```

When enabled, if no `store_memory` call happened during the session (tracked
by the `automem-track-store.sh` PostToolUse sentinel) and the session is
substantive (≥5 human prompts in the transcript — tool results and meta
entries don't count), the Stop hook sends Claude one neutral
`additionalContext` line: no memory was stored, durable candidates are
corrections/stabilized decisions/articulated patterns/root-cause insights,
and session summaries/progress notes/confirmations/temporary output are not
candidates. The nudge never blocks, but current Claude Code interactive UI may
show a small "Stop hook feedback" block and an extra assistant response.

The wording is deliberately factual instead of command-like. Claude Code's
hook docs say `additionalContext` is hidden from chat, while also warning
that out-of-band command phrasing may be surfaced by prompt-injection
defenses. Maintainers can compare real host behavior with:

```bash
npm run probe:claude-stop-context
```

The probe runs three Stop-hook variants under temp project settings via
`claude -p --verbose --output-format stream-json --include-hook-events --debug-file ...`:
current imperative text, neutral factual context, and a plain-stdout negative
control. Below the threshold the optional hook leaves its once-per-session
sentinel unburned, so a session that grows past 5 prompts can still get its
one nudge later.

Historical note: earlier versions mechanically captured build/test/deploy
results into a JSONL memory queue drained by Stop hooks. That whole pipeline
was retired — templated "Build succeeded…" one-liners drowned out real
memories in recall, and once the capture hooks were gone nothing wrote to
the queue. Re-running the installer removes the retired hook entries AND
their orphaned script files from existing installs. The
`npx @verygoodplugins/mcp-automem queue` CLI remains for manually draining
a queue file you point it at.

## Available Tools

- `store_memory` - Save memories with tags, importance, metadata. Supports **batch mode** via `memories: [...]` (≤500 items)
- `recall_memory` - Hybrid search with graph expansion and context hints. Also supports **ID fetch** (`memory_id`) and **tag enumeration** (`exhaustive: true` + `tags`, paginated)
- `associate_memories` - Create relationships (11 public authorable types)
- `update_memory` - Modify existing memories
- `delete_memory` - Remove memory by ID or **bulk-by-tag** (`tags: [...]`)
- `check_database_health` - Monitor service status

## Tips

1. **Use the plugin for new installs** - It is the recommended Claude Code integration; the CLI installer covers settings-level needs.
2. **Manual config is fallback-only** - Keep it for advanced or locked-down environments.
3. **Keep memories concise** - Target 150-300 chars; max 500 chars (auto-summarized beyond that).
4. **Use bare tags** - Avoid platform tags and date tags in stored memories.
5. **Clean up** - Use `delete_memory` for outdated information.

## Troubleshooting

### Memories not storing

- Check MCP server is configured in `~/.claude.json`
- Verify AutoMem service is running: `curl $AUTOMEM_API_URL/health`
- Check permissions in `~/.claude/settings.json`

### Recall not finding results

- Ensure memories are tagged with project name
- Try broader queries or fewer tag filters
- Check time range isn't too restrictive

## Learn More

- [Claude Code Memory Rules Template](CLAUDE_MD_MEMORY_RULES.md) - Full instructions for `~/.claude/CLAUDE.md`
- [Claude Desktop Personal Preferences Template](CLAUDE_DESKTOP_INSTRUCTIONS.md) - Paste-ready Desktop instructions
- [AutoMem Documentation](https://github.com/verygoodplugins/automem) - Backend service
- [MCP Tools Reference](../INSTALLATION.md#mcp-tools) - All memory operations
- [Deprecations](../DEPRECATION.md) - history of the plugin deprecation and its reversal
