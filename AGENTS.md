# AutoMem MCP Server Repo Guidance

## Host integration smoke tests

When adding or changing a client host integration, test the real host boundary instead of only checking generated config.

- Use a temp home or workspace for the host so tests never mutate the developer's real config.
- Use the shared fake AutoMem API for `/health`, recall, store, update, and associate calls.
- Start the real stdio MCP server process from the configured command and assert stdout contains only MCP JSON-RPC.
- When the host is installed locally, instantiate the real host agent or CLI surface and capture provider-visible tool names before any live model call.
- Assert tool names are unique across the final provider payload, not just within AutoMem tools.
- Add uninstall coverage for every file, config key, plugin directory, and environment key the installer writes.
- Redact secrets and isolate env vars; never let a real `AUTOMEM_API_KEY` leak into temp config or snapshots.
- Keep `tests/helpers/host-specs.ts` updated as the executable host integration contract for Hermes, Claude Code, Codex, Cursor, and future platforms.

Documentation changes are part of the integration contract. Any new host mode or uninstall behavior should be reflected in `INSTALLATION.md` and covered by a smoke/doc assertion.
