# MCP AutoMem 0.15 Website Handoff

Date: 2026-06-19

## Source State

- MCP repo: `/Users/jgarturo/Projects/OpenAI/mcp-servers/mcp-automem` at `f67ac29c8f59fc75cd0f7c8296fabc5bc71638f9` before local 0.15 prep changes.
- AutoMem service repo: `/Users/jgarturo/Projects/OpenAI/automem` at `28eb916eae430f80ebee57d44f63b712b9d45398`.
- Service comparison audited: `v0.15.2` (`394131912b475d0b182151636f3013588b5b1854`) through service `main` (`28eb916`).
- Website repo audited: `/Users/jgarturo/Projects/OpenAI/automem-website` at `6b3018b2ed9da077665124da41af16495f676aba`.
- npm `@verygoodplugins/mcp-automem@latest` was still `0.14.0` during this audit. Do not say the live installer is fixed until `0.15.0` is published.

## Release Positioning

Ship MCP AutoMem `0.15.0`, not `1.0.0`.

Copy:

> MCP AutoMem 0.15 restores the public installer path and brings the MCP bridge back into parity with AutoMem service 0.15 recall, relationship, and health diagnostics. It keeps the six-tool MCP surface: new capabilities are exposed as parameter modes on existing tools instead of adding tool bloat.

## Installer Copy

After npm `@latest` is `0.15.0`, update install commands from:

```bash
npx @verygoodplugins/mcp-automem setup
```

to:

```bash
npx @verygoodplugins/mcp-automem install
```

The website `install.sh` should continue to support:

```bash
curl -fsSL https://automem.ai/install.sh | sh
curl -fsSL https://automem.ai/install.sh | AUTOMEM_DRY_RUN=1 sh
curl -fsSL https://automem.ai/install.sh | AUTOMEM_PACKAGE_SPEC=@verygoodplugins/mcp-automem@0.15.0 sh
```

Remove or reword the "guided installer unavailable in npm latest" warning only after publish verification passes.

## MCP Parameter Changes

Update every MCP recall schema/table to include these ranked-only params:

- `state_mode`: `current` or `history`
- `recency_bias`: `auto`, `on`, or `off`
- `scope_fallback`: boolean; allows outside-tag fallback when scoped evidence is weak
- `expand_respect_tags`: boolean; keeps graph/entity expansion inside tag scope when true
- `min_score`: number threshold
- `adaptive_floor`: boolean

Update recall response docs to preserve these diagnostics:

- top-level: `state_mode`, `tag_scope`, `scope_fallback`, `recency_bias`, `score_filter`, `queries`, `query_time_ms`, `vector_search`, `jit_enriched_count`, `entities`
- per-result: `outside_tag_scope`, `deduped_from`, `state_replaces`, enrichment/provenance flags such as `jit_enriched`

Replace old graph-expansion guidance:

> Drop tags before `expand_relations`.

with:

> Use `expand_respect_tags: true` when graph/entity expansion must stay inside the requested tag scope. Leave it false, or omit the tag gate, when broader related context is intended. If `scope_fallback` admits outside-scope results, they are marked with `outside_tag_scope`.

## Relationship Changes

Document `associate_memories` as two modes:

```javascript
associate_memories({
  memory1_id: "new-decision",
  memory2_id: "old-decision",
  type: "INVALIDATED_BY",
  strength: 0.9,
  reason: "Superseded by the 0.15 release plan"
})
```

```javascript
associate_memories({
  associations: [
    {
      memory1_id: "bug-fix-123",
      memory2_id: "feature-456",
      type: "RELATES_TO",
      strength: 0.8
    }
  ]
})
```

Batch details:

- max `500` association items
- partial responses return `created_count`, `failed_count`, `succeeded`, `failed`, and `summary`
- relation-specific optional props include `reason`, `context`, `resolution`, `observations`, `transformation`, `role`, `pattern_type`, `confidence`, and `timestamp`

Keep the taxonomy clear:

- authorable: `RELATES_TO`, `LEADS_TO`, `OCCURRED_BEFORE`, `PREFERS_OVER`, `EXEMPLIFIES`, `CONTRADICTS`, `REINFORCES`, `INVALIDATED_BY`, `EVOLVED_INTO`, `DERIVED_FROM`, `PART_OF`
- read-only/internal may appear in recall results: `SIMILAR_TO`, `PRECEDED_BY`, `EXPLAINS`, `SHARES_THEME`, `PARALLEL_CONTEXT`, `DISCOVERED`

## Health Changes

Update MCP health docs so `check_database_health` can return:

- `status`: `healthy`, `degraded`, or `error`
- `statistics.memory_count`
- `statistics.vector_count`
- `statistics.sync_status`
- `statistics.vector_dimensions`
- `statistics.enrichment`

Do not describe reachable degraded service state as an MCP `error`.

## Website Pages To Update

- `src/lib/install-commands.ts`: make `install` the primary command after npm publish.
- `public/install.sh`: remove/reword npm-latest warning after publish verification.
- `src/content/docs/docs/reference/api/direct-vs-mcp.md`: update MCP schemas for store batch, recall params/diagnostics, batch associate, bulk delete, and degraded health.
- `src/content/docs/docs/reference/api/recall-operations.md`: add new recall params and diagnostics.
- `src/content/docs/docs/reference/api/relationships.md`: add batch association and relation-specific props.
- `src/content/docs/docs/core-concepts/hybrid-search.md`: update `expand_respect_tags` and `scope_fallback` guidance.
- `src/content/docs/docs/core-concepts/relationship-types.md`: fix read-only/internal relation list.
- `src/content/docs/docs/reference/configuration.md`: fix relation taxonomy summary.
- `src/content/docs/docs/platforms/claude-code.md`: plugin is recommended; CLI installer is the settings-level alternative; retired capture/session/queue/Python hooks should not be listed as installed.
- `src/content/docs/docs/cli/platform-installers.md`: remove retired hook/script claims.
- `src/content/docs/docs/cli/queue.md`: queue is manual-only; hooks no longer write to it.
- `src/content/docs/docs/reference/api/health.md` and `src/content/docs/docs/operations/health.md`: reconcile degraded/Qdrant behavior and add diagnostics.
- `src/content/docs/docs/development/releases.md`: update version-sync paths and pre-major Release Please behavior.
- `src/content/docs/docs/development/changelog.md`: add MCP 0.15 entry.

## Copy-Ready Release Notes

### MCP AutoMem 0.15.0

- Restores the public installer path by publishing the guided `install` command used by `https://automem.ai/install.sh`.
- Keeps the release pre-1.0 and configures Release Please so breaking commits before `1.0.0` bump minor instead of major.
- Adds batch `associate_memories` mode with partial-success reporting and relation-specific props.
- Adds ranked recall params for state mode, recency bias, scope fallback, tag-respecting expansion, and score filtering.
- Preserves recall diagnostics and per-result provenance in MCP structured output.
- Preserves degraded health diagnostics instead of flattening reachable degraded service state to `error`.
- Keeps HTTP-only service endpoints such as `/analyze`, `/startup-recall`, and related-memory admin views out of the MCP tool surface for this release.

## Publish-Gated Verification

Before changing live website copy to say the installer is fixed:

```bash
npm view @verygoodplugins/mcp-automem version dist-tags --json
curl -fsSL https://automem.ai/install.sh | AUTOMEM_DRY_RUN=1 sh
```

Expected after publish: npm latest is `0.15.0`, and the dry-run install script reaches the guided installer path instead of warning that `install` is missing.
