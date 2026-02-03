# Changelog

All notable changes to this project will be documented in this file.

## [0.11.0](https://github.com/verygoodplugins/mcp-automem/compare/mcp-automem-v0.10.1...mcp-automem-v0.11.0) (2026-02-03)


### Features

* Add Claude Code plugin structure for AutoMem ([638dbd5](https://github.com/verygoodplugins/mcp-automem/commit/638dbd5f4f933712e9a17f3e1627f5ad7c537454))
* Add Cursor hooks integration with automatic memory capture ([86abd65](https://github.com/verygoodplugins/mcp-automem/commit/86abd65234ec8e6d34ad3857a730122c39cb5510))
* Add expansion filtering params for noise reduction ([1376277](https://github.com/verygoodplugins/mcp-automem/commit/1376277ac91f0b43682a0e31d3c6d839620eab2d))
* Add expansion filtering params for noise reduction ([2c1058e](https://github.com/verygoodplugins/mcp-automem/commit/2c1058e5c50cd897000ef45e800e3a062dd098f4))
* add integration tests and CLI smoke tests ([#51](https://github.com/verygoodplugins/mcp-automem/issues/51)) ([f89a92d](https://github.com/verygoodplugins/mcp-automem/commit/f89a92dca138510bd02349d88f281205e465db47))
* add MCP Registry support ([#16](https://github.com/verygoodplugins/mcp-automem/issues/16)) ([ee9571e](https://github.com/verygoodplugins/mcp-automem/commit/ee9571eb874eb188a48f58859cb43be368435c0c))
* add memory content size guidelines and warnings ([5ac5833](https://github.com/verygoodplugins/mcp-automem/commit/5ac5833cfd357dd173fbb7638d6e5b44a87e3fc8))
* **claude-code:** add SessionStart hook for automatic memory recall ([2a4859b](https://github.com/verygoodplugins/mcp-automem/commit/2a4859b1d552dd147246701da5a9513aa66f86e8))
* **claude-code:** add SessionStart hook for automatic memory recall ([8e4fdc7](https://github.com/verygoodplugins/mcp-automem/commit/8e4fdc7ccb69ad6b9663277d402a39c71e3c6eb3))
* **cursor-hooks:** Add automatic log rotation to prevent disk bloat ([da0b265](https://github.com/verygoodplugins/mcp-automem/commit/da0b26515bc0304db10c7d6c146fde3af5ffee44))
* **cursor-hooks:** Add verbose logging to show memory content ([9b90443](https://github.com/verygoodplugins/mcp-automem/commit/9b904431ca4975ccf373e2a9399633106fe1d9fd))
* Initial release of MCP AutoMem server ([4b5f262](https://github.com/verygoodplugins/mcp-automem/commit/4b5f262275fc6076d1f1252111f1636d0e80f1f8))
* Memory content size guidelines and warnings ([909f07a](https://github.com/verygoodplugins/mcp-automem/commit/909f07ab91ad2c48945d363192e121c7a3f1c3db))
* **recall:** add expansion filtering parameters (expand_min_importance, expand_min_strength) ([fb4bfd5](https://github.com/verygoodplugins/mcp-automem/commit/fb4bfd5e4319693d5491a39f6d4680167d729b82))
* unify recall_memory and recall_memory_multi into single tool ([ef866da](https://github.com/verygoodplugins/mcp-automem/commit/ef866dad1bf9324804616cfe52eeba2f6c7d38a2))
* upgrade SDK to 1.25.1 and add MCP registry support ([766c857](https://github.com/verygoodplugins/mcp-automem/commit/766c857aacf8be9dc4056e99a84ace952713d354))
* upgrade SDK to 1.25.1 and add MCP registry support ([14a06ce](https://github.com/verygoodplugins/mcp-automem/commit/14a06ce7f0b7797289f149d04eed0b871d4caa0e))
* v0.8.0 - Advanced recall capabilities and MCP best practices ([c8f1dcc](https://github.com/verygoodplugins/mcp-automem/commit/c8f1dcce261fd1beacee7ee90becb1ad648a96df))
* v0.8.0 - Advanced recall capabilities and MCP best practices ([48e1fa2](https://github.com/verygoodplugins/mcp-automem/commit/48e1fa263ec93c309a2e8bc1fe063a1a243d9688))


### Bug Fixes

* add exponential backoff retry logic for transient API failures ([6395689](https://github.com/verygoodplugins/mcp-automem/commit/63956893dd3b911038c6d8eaaabf5ec57b941c7a))
* add missing success field to associate_memories response ([#12](https://github.com/verygoodplugins/mcp-automem/issues/12)) ([baa697b](https://github.com/verygoodplugins/mcp-automem/commit/baa697b6fd07a4e2e9b193ee0e7f5e88b476e0d0))
* add security.yml workflow with CodeQL v4 ([861d60f](https://github.com/verygoodplugins/mcp-automem/commit/861d60f3d6a00484e9dfcc8f96c876ae61b7c581))
* Add structuredContent to all tool handlers ([c0615ef](https://github.com/verygoodplugins/mcp-automem/commit/c0615ef624c8cc702603ced72ae7d0cab788cd6a))
* address coderabbit review feedback ([7e15521](https://github.com/verygoodplugins/mcp-automem/commit/7e15521097fc56b604b887b1b345ac7dbeaacb9e))
* allowlist MCP SDK ReDoS vulnerability (GHSA-8r9q-7v3j-jr4g) ([129b665](https://github.com/verygoodplugins/mcp-automem/commit/129b665cd2fa59628d229e3855aee13852c2c68a))
* **auth:** accept AUTOMEM_API_TOKEN alias ([#27](https://github.com/verygoodplugins/mcp-automem/issues/27)) ([3dfcd1f](https://github.com/verygoodplugins/mcp-automem/commit/3dfcd1f18346677d487575004ad5ec50007a40cf)), closes [#26](https://github.com/verygoodplugins/mcp-automem/issues/26)
* **claude-code:** avoid osascript quoting errors ([#30](https://github.com/verygoodplugins/mcp-automem/issues/30)) ([474c47b](https://github.com/verygoodplugins/mcp-automem/commit/474c47b97cfe2ec76b5857ce775d350edc10a0af))
* correct .mcpb filename and update community links ([#49](https://github.com/verygoodplugins/mcp-automem/issues/49)) ([a3b8c71](https://github.com/verygoodplugins/mcp-automem/commit/a3b8c71f54a3d58d5d54e2c7ac0cb9dddfbb4ff0))
* **cursor-hooks:** Read AUTOMEM env vars from mcp.json ([7c73ce3](https://github.com/verygoodplugins/mcp-automem/commit/7c73ce38cb2a5e32469703d34bf9569fde2084e9))
* enforce security audits and fix server.json structure ([f7dc0a1](https://github.com/verygoodplugins/mcp-automem/commit/f7dc0a1aa63f0c1f021f661297022c36718b7e73))
* exclude GitHub compare URLs from link checker ([#52](https://github.com/verygoodplugins/mcp-automem/issues/52)) ([d7212fd](https://github.com/verygoodplugins/mcp-automem/commit/d7212fd6507d2b1c56424c8da46dd8a055463ce7))
* function name in CLAUDE_MD_MEMORY_RULES.md ([3d102d5](https://github.com/verygoodplugins/mcp-automem/commit/3d102d53adcd81dda8deca2f8beb46115f1a3fd3))
* harden hook scripts and queue cleanup ([0d992d7](https://github.com/verygoodplugins/mcp-automem/commit/0d992d721184ca3a058b91c740094bf1c218add9))
* Match structuredContent to outputSchema for recall_memory ([97e8d0f](https://github.com/verygoodplugins/mcp-automem/commit/97e8d0f30914221231ac5ba7bc203a1e82937144))
* **plugin:** make process-session-memory.py self-contained ([#39](https://github.com/verygoodplugins/mcp-automem/issues/39)) ([a96173c](https://github.com/verygoodplugins/mcp-automem/commit/a96173c9d56cb2ed0fb2a4d8396445390668a991)), closes [#36](https://github.com/verygoodplugins/mcp-automem/issues/36)
* **queue:** handle ENOENT errors when deleting queue file ([#29](https://github.com/verygoodplugins/mcp-automem/issues/29)) ([a98f2e5](https://github.com/verygoodplugins/mcp-automem/commit/a98f2e55920181b2757edb7ed13f215846d68915))
* reduce Cursor stderr noise and stdio flapping ([6354d64](https://github.com/verygoodplugins/mcp-automem/commit/6354d64cf6fde6f12996da9e2894e8de3e934851))
* reduce Cursor stderr noise and stdio flapping ([c07171a](https://github.com/verygoodplugins/mcp-automem/commit/c07171a75d390524d197da1c18c3bb5d8850be9e))
* Refactor AutoMem plugin structure and update docs ([0c2453a](https://github.com/verygoodplugins/mcp-automem/commit/0c2453a73fcaeff2081dafd036dca4b67a43191c))
* reject oversized memories and use placeholder for month tags ([bc6f730](https://github.com/verygoodplugins/mcp-automem/commit/bc6f7301cf3f003ab47ac0de51b158fb3c187473))
* remove duplicate hooks declaration causing load error ([#35](https://github.com/verygoodplugins/mcp-automem/issues/35)) ([65d6db5](https://github.com/verygoodplugins/mcp-automem/commit/65d6db54c7b450b33af02f6659c420cade1cd0c2))
* resolve MD033 linter warnings for HTML elements ([bc2a4a5](https://github.com/verygoodplugins/mcp-automem/commit/bc2a4a5996ba8fb63941d53517b3ab45d16f953d))
* Update Cursor install button to official deeplink format ([70ef846](https://github.com/verygoodplugins/mcp-automem/commit/70ef846c6cddea53d5be925d98826f683e690954))
* use correct better-npm-audit version (3.11.0) ([31db0ab](https://github.com/verygoodplugins/mcp-automem/commit/31db0aba8fc7a77c7296779310f5f908cb22d372))
* use release-please manifest mode for server.json updates ([#46](https://github.com/verygoodplugins/mcp-automem/issues/46)) ([15a5831](https://github.com/verygoodplugins/mcp-automem/commit/15a5831d7f06f0da5d487a22286353fdc5451f45))

## [0.10.1](https://github.com/verygoodplugins/mcp-automem/compare/v0.10.0...v0.10.1) (2026-02-02)


### Bug Fixes

* **auth:** accept AUTOMEM_API_TOKEN alias ([#27](https://github.com/verygoodplugins/mcp-automem/issues/27)) ([3dfcd1f](https://github.com/verygoodplugins/mcp-automem/commit/3dfcd1f18346677d487575004ad5ec50007a40cf)), closes [#26](https://github.com/verygoodplugins/mcp-automem/issues/26)
* **claude-code:** avoid osascript quoting errors ([#30](https://github.com/verygoodplugins/mcp-automem/issues/30)) ([474c47b](https://github.com/verygoodplugins/mcp-automem/commit/474c47b97cfe2ec76b5857ce775d350edc10a0af))
* **queue:** handle ENOENT errors when deleting queue file ([#29](https://github.com/verygoodplugins/mcp-automem/issues/29)) ([a98f2e5](https://github.com/verygoodplugins/mcp-automem/commit/a98f2e55920181b2757edb7ed13f215846d68915))
* remove duplicate hooks declaration causing load error ([#35](https://github.com/verygoodplugins/mcp-automem/issues/35)) ([65d6db5](https://github.com/verygoodplugins/mcp-automem/commit/65d6db54c7b450b33af02f6659c420cade1cd0c2))

## [0.10.0](https://github.com/verygoodplugins/mcp-automem/compare/v0.9.1...v0.10.0) (2026-01-06)


### Features

* add MCP Registry support ([#16](https://github.com/verygoodplugins/mcp-automem/issues/16)) ([ee9571e](https://github.com/verygoodplugins/mcp-automem/commit/ee9571eb874eb188a48f58859cb43be368435c0c))
* add memory content size guidelines and warnings ([5ac5833](https://github.com/verygoodplugins/mcp-automem/commit/5ac5833cfd357dd173fbb7638d6e5b44a87e3fc8))
* **claude-code:** add SessionStart hook for automatic memory recall ([2a4859b](https://github.com/verygoodplugins/mcp-automem/commit/2a4859b1d552dd147246701da5a9513aa66f86e8))
* **claude-code:** add SessionStart hook for automatic memory recall ([8e4fdc7](https://github.com/verygoodplugins/mcp-automem/commit/8e4fdc7ccb69ad6b9663277d402a39c71e3c6eb3))
* Memory content size guidelines and warnings ([909f07a](https://github.com/verygoodplugins/mcp-automem/commit/909f07ab91ad2c48945d363192e121c7a3f1c3db))
* upgrade SDK to 1.25.1 and add MCP registry support ([766c857](https://github.com/verygoodplugins/mcp-automem/commit/766c857aacf8be9dc4056e99a84ace952713d354))
* upgrade SDK to 1.25.1 and add MCP registry support ([14a06ce](https://github.com/verygoodplugins/mcp-automem/commit/14a06ce7f0b7797289f149d04eed0b871d4caa0e))


### Bug Fixes

* add exponential backoff retry logic for transient API failures ([6395689](https://github.com/verygoodplugins/mcp-automem/commit/63956893dd3b911038c6d8eaaabf5ec57b941c7a))
* add security.yml workflow with CodeQL v4 ([861d60f](https://github.com/verygoodplugins/mcp-automem/commit/861d60f3d6a00484e9dfcc8f96c876ae61b7c581))
* address coderabbit review feedback ([7e15521](https://github.com/verygoodplugins/mcp-automem/commit/7e15521097fc56b604b887b1b345ac7dbeaacb9e))
* allowlist MCP SDK ReDoS vulnerability (GHSA-8r9q-7v3j-jr4g) ([129b665](https://github.com/verygoodplugins/mcp-automem/commit/129b665cd2fa59628d229e3855aee13852c2c68a))
* enforce security audits and fix server.json structure ([f7dc0a1](https://github.com/verygoodplugins/mcp-automem/commit/f7dc0a1aa63f0c1f021f661297022c36718b7e73))
* function name in CLAUDE_MD_MEMORY_RULES.md ([3d102d5](https://github.com/verygoodplugins/mcp-automem/commit/3d102d53adcd81dda8deca2f8beb46115f1a3fd3))
* harden hook scripts and queue cleanup ([0d992d7](https://github.com/verygoodplugins/mcp-automem/commit/0d992d721184ca3a058b91c740094bf1c218add9))
* reduce Cursor stderr noise and stdio flapping ([6354d64](https://github.com/verygoodplugins/mcp-automem/commit/6354d64cf6fde6f12996da9e2894e8de3e934851))
* reduce Cursor stderr noise and stdio flapping ([c07171a](https://github.com/verygoodplugins/mcp-automem/commit/c07171a75d390524d197da1c18c3bb5d8850be9e))
* Refactor AutoMem plugin structure and update docs ([0c2453a](https://github.com/verygoodplugins/mcp-automem/commit/0c2453a73fcaeff2081dafd036dca4b67a43191c))
* reject oversized memories and use placeholder for month tags ([bc6f730](https://github.com/verygoodplugins/mcp-automem/commit/bc6f7301cf3f003ab47ac0de51b158fb3c187473))
* resolve MD033 linter warnings for HTML elements ([bc2a4a5](https://github.com/verygoodplugins/mcp-automem/commit/bc2a4a5996ba8fb63941d53517b3ab45d16f953d))
* use correct better-npm-audit version (3.11.0) ([31db0ab](https://github.com/verygoodplugins/mcp-automem/commit/31db0aba8fc7a77c7296779310f5f908cb22d372))

## [Unreleased]

### Added

- **Claude Code Plugin**: Native plugin for Claude Code with `/plugin install` support
  - New plugin structure at `plugins/automem/` with proper Claude Code plugin spec
  - **Memory Management Skill**: Teaches Claude the 3-phase memory pattern (Recall → Store → Summarize)
  - **Slash Commands**: `/memory-recall`, `/memory-store`, `/memory-health`
  - **SessionStart Hook**: Automatic memory recall prompt at session start
  - **MCP Server Configuration**: Pre-configured connection to AutoMem service
  - **Marketplace Support**: Install via `/plugin marketplace add verygoodplugins/mcp-automem`

### Changed

- Updated package.json to include `plugins/` and `.claude-plugin/` directories
- Updated README with plugin installation instructions for Claude Code
## 0.9.1 - 2025-12-10

### Fixed
- **associate_memories structured output**: Fixed missing `success` field in response that caused "Structured content does not match output schema" error

## 0.9.0 - 2025-12-10

### Added
- **Expansion filtering parameters**: Reduce noise in graph-expanded results
- **Version-aware template updates**: The `cursor` command now detects outdated `automem.mdc` files
  - Shows what's new in the latest version
  - Prompts user before updating (use `--yes` to auto-update)
  - Creates backup before overwriting
  - Templates now include version markers for future upgrade detection
  - Version is read dynamically from `package.json` (single source of truth)
  - `expand_min_importance` - Minimum importance score for expanded results (0-1)
  - `expand_min_strength` - Minimum relation strength to follow during expansion (0-1)
  - Server-side filtering keeps seed results intact, only filters expanded memories
  - Addresses issue where `expand_relations=true` returned too many low-relevance memories

### Changed
- Updated `RecallMemoryArgs` interface with expansion filtering parameters
- Updated `AutoMemClient.recallMemory()` to pass filtering params to backend

### Documentation
- Updated `INSTALLATION.md` with new expansion filtering parameters
- Updated `templates/cursor/automem.mdc.template` with filtering examples
- Updated `templates/CLAUDE_MD_MEMORY_RULES.md` with filtering parameters
- Updated `README.md` feature list

### Note
- Requires AutoMem server v0.9.2+ for full filtering support

## 0.8.1 - 2025-12-04

### Fixed
- **MCP spec compliance**: All tool handlers now return `structuredContent` alongside `content`
  - Required when `outputSchema` is defined per MCP specification
  - Fixes error: "Tool has an output schema but did not return structured content"
- **recall_memory output**: Changed `memories` to `results` to match `outputSchema`
- Added `dedup_removed` field to recall output

## 0.8.0 - 2025-12-02

### Changed
- **Claude Code integration simplified**: Removed hook-based capture system in favor of direct MCP usage
  - Removed all automatic capture hooks (builds, commits, edits, tests, deployments, errors)
  - Removed queue-based processing (Python processors, cleanup scripts)
  - Removed desktop notifications (smart-notify.sh)
  - Now uses simple approach: MCP permissions + memory rules in CLAUDE.md
  - Philosophy: Trust Claude + good instructions > automated hooks that guess significance
  - Claude has direct MCP access and can judge what's worth storing
- **Claude Code now stable**: Removed "experimental" warning from README and documentation
  - Platform support table updated: Claude Code now shows "✅ Full" status
  - Simplified installation: just permissions + memory rules

### Removed
- `templates/claude-code/hooks/` - All hook scripts (capture-*.sh, session-memory.sh)
- `templates/claude-code/scripts/` - Python processors, queue cleanup, notifications
- `templates/claude-code/profiles/` - Profile system (lean/extras no longer needed)
- `--profile` CLI flag from `claude-code` command
- `templates/warp/` - Warp Terminal integration (niche use case, reduces maintenance)

### Added
- **Advanced recall capabilities**: Exposed AutoMem server's multi-hop reasoning and context features
  - `expand_entities` - Multi-hop reasoning via entity expansion (e.g., "What is Amanda's sister's job?" finds Rachel → Rachel's job)
  - `expand_relations` - Follow graph relationships (RELATES_TO, LEADS_TO, etc.) from seed results
  - `auto_decompose` - Automatically split complex queries into sub-queries for broader recall
  - `context` - Context label for preference boosting (e.g., "coding-style", "architecture")
  - `language` - Programming language hint to prioritize language-specific memories
  - `active_path` - Current file path for automatic language detection
  - `context_tags` - Priority tags to boost in results
  - `context_types` - Priority memory types (Decision, Pattern, etc.) to boost
  - `priority_ids` - Specific memory IDs to ensure inclusion in results
  - `expansion_limit`, `relation_limit` - Control expansion depth

- **MCP 2025 best practices**: Enhanced tool definitions for better LLM usage
  - Added `title` to all tools for human-readable display
  - Added `annotations` with hints: `readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`
  - Added `outputSchema` to all tools for structured response expectations
  - Added detailed usage examples and "When to use" sections in tool descriptions
  - All 11 relationship types now properly documented in `associate_memories` schema

- **Enhanced response information**:
  - `expansion` metadata in recall results (seed_count, expanded_count, relation_limit)
  - `entity_expansion` metadata (entities_found, expanded_count)
  - `context_priority` metadata (applied language, context, priority tags/types)

### Changed
- Updated `RecallMemoryArgs` interface with all new parameters
- Updated `RecallResult` interface with expansion metadata
- Enhanced `AutoMemClient.recallMemory()` to pass all new parameters to backend
- Improved recall handler to display expansion information in response

### Documentation
- **INSTALLATION.md**: Comprehensive update to MCP Tools section
  - Full parameter documentation for all tools
  - Graph expansion examples with multi-hop reasoning
  - Context-aware recall examples for coding tasks
  - Association best practices with strength guidelines
- **templates/cursor/automem.mdc.template**: Added Advanced Recall Features section
  - Multi-hop reasoning examples
  - Graph expansion and auto-decomposition
  - Context-aware coding patterns
  - Priority injection for specific memories
- **templates/CLAUDE_MD_MEMORY_RULES.md**: Updated recall patterns
  - Multi-query recall, entity expansion, graph expansion
  - Context-aware recall for coding tasks
  - Auto query decomposition

### Technical
- Bumped version to 0.8.0 in `src/index.ts`
- Types now fully aligned with AutoMem server API capabilities

## 0.7.0 - 2025-12-02

### Changed
- **Unified `recall_memory` tool**: Consolidated `recall_memory` and `recall_memory_multi` into a single tool
  - Now accepts both `query` (string) for single searches and `queries` (array) for multi-query searches
  - Server-side deduplication automatically handles overlapping results
  - Simpler mental model: one tool for all recall operations
  - Displays deduplication info when multiple queries are used

### Added
- `queries` parameter to `recall_memory` tool schema
- `dedup_removed` and `deduped_from` fields in response types
- Support for `queries` array in `AutoMemClient.recallMemory()`

### Removed
- `recall_memory_multi` tool (functionality merged into `recall_memory`)

### Benefits
- Fewer tools = less confusion for LLMs
- Backward compatible: existing `query` usage unchanged
- Multi-query support just works when you pass `queries` array

## 0.6.2 - 2025-10-14

### Added
- **Memory association documentation**: Added detailed association patterns and examples to `INSTALLATION.md`
  - Comprehensive guide on linking related memories
  - When and how to create associations between memories
  - Examples of common association patterns
  - Best practices for building a knowledge graph

### Improved
- **Parallel recall performance**: Updated `recall_memory` handler to fetch primary and tag-based results in parallel
  - Better performance through concurrent API calls
  - More robust error handling and result merging
  - Enhanced reliability when combining multiple data sources
- **HTTP request timeout**: Set 25-second timeout for all AutoMem API requests in client
  - Prevents hung connections
  - Better error handling for slow/unavailable services

## 0.6.1 - 2025-10-05

### Changed
- **Updated templates for new AutoMem API type field**: All templates now use explicit `type` parameter instead of `[TYPE]` prefixes in content
  - Added support for memory classification types: `Decision`, `Pattern`, `Insight`, `Preference`, `Style`, `Habit`, `Context`
  - Added `confidence` parameter (defaults to 0.9 when type is provided, auto-computed otherwise)
  - Removed `[DECISION]`, `[BUG-FIX]`, `[PATTERN]`, etc. prefixes from content examples
  - Updated all code examples to use clean content with explicit type field
  - Type is optional - omit for auto-classification by enrichment pipeline
- **Template updates**:
  - `templates/cursor/automem.mdc.template` - Complete rewrite with new type field approach
  - `AGENTS.md` - Updated with type field examples and removed redundant `codex` tag
  - `templates/CLAUDE_MD_MEMORY_RULES.md` - Comprehensive type field documentation
  - `templates/codex/memory-rules.md` - Updated examples and removed redundant `codex` tag
  - `templates/warp/warp-rules.md` - Terminal-focused type field examples
- **Documentation improvements**:
  - Added "Memory Types" section to cursor template explaining all valid types
  - Added "Type selection guide" with best practices
  - Updated "Content Structure" section with cleaner examples
  - Added note to avoid type prefixes in "NEVER STORE" section
  - Updated Tool Reference with full parameter documentation

### Benefits
- Cleaner, more semantic memory content without bracket prefixes
- Better auto-classification when type is omitted
- More accurate categorization with explicit type field
- Consistent API usage across all platforms
- Forward-compatible with future AutoMem API enhancements

## 0.6.0 - 2025-10-04

### Breaking Changes
- **Removed Cursor hooks-based installation**: Simplified Cursor integration to use `.cursor/rules/automem.mdc` only
  - Deleted `templates/cursor/hooks/` directory and all hook scripts
  - Deleted `templates/CURSOR_HOOKS_INTEGRATION.md` (668 lines)
  - Deleted `templates/cursor/AGENTS.md.template`, `.cursorrules.template`, and multi-agent templates
  - Removed `--hooks` flag from `cursor` CLI command
  - Rationale: Cursor's hook system proved unreliable and overly complex. The `.mdc` rule file approach is simpler, more stable, and gives better results with less maintenance burden.

### Claude Code Improvements
- **Marked as experimental**: Claude Code hooks-based installation now clearly labeled as experimental throughout
  - Added prominent ⚠️ warnings to `INSTALLATION.md` and `templates/CLAUDE_CODE_INTEGRATION.md`
  - Added CLI warning during installation explaining experimental status and default profile
  - Updated README.md platform table: Changed from "✅ Full" to "⚠️ Experimental"
- **Simplified setup and documentation**:
  - Removed redundant `settings.lean.json` profile (main `settings.json` is now the lean default)
  - Simplified optional hooks documentation - now points to `profiles/settings.extras.json` instead of verbose JSON examples
  - Added `queue-cleanup.sh` script for deduplication at session end
  - Strengthened opt-in messaging in `CLAUDE_MD_MEMORY_RULES.md`
  - Default profile now explicitly documented as minimal (git commits + builds only)
- **Profile system cleanup**:
  - Main `settings.json` is the default lean profile (git commits + builds + queue cleanup)
  - `profiles/settings.extras.json` remains for users who want all optional hooks
  - Clear guidance on using `--profile extras` flag

### Documentation
- **Simplified Railway deployment guide**:
  - Removed screenshot image references throughout (images will be added to documentation site)
  - Streamlined manual setup instructions
  - Consolidated storage setup steps (removed redundant FalkorDB volume section from README)
  - Clearer step numbering and flow
- **Installation guide improvements**:
  - More prominent experimental warnings for Claude Code
  - Simplified Warp Terminal setup (now references template files directly)
  - Improved clarity around platform support status
  - Better distinction between stable (Claude Desktop, Cursor) and experimental (Claude Code) integrations
- **Template cleanup**:
  - Removed 11 obsolete Cursor template files (hooks, agents, rules)
  - Updated inline documentation in remaining templates
  - Simplified config examples

### Fixed
- **Uninstall command**: Updated to handle new simplified Cursor setup (no hooks to remove)
- **CLI cursor command**: Removed hook-related logic, focused on `.mdc` rule file only

### Removed
- All Cursor hooks infrastructure (563 lines of hook scripts)
- `CURSOR_HOOKS_INTEGRATION.md` documentation
- Multi-agent Cursor templates (AGENTS.md, memory-keeper.md, project-assistant.md)
- Obsolete screenshots (cursor-hooks-1.jpg, cursor-settings-1.jpg)
- Redundant Claude Code lean profile

### Development
- Built and compiled TypeScript changes to `dist/`
- Updated all affected CLI commands and handlers
- Total reduction: ~3,982 lines removed, ~1,218 lines modified/added (net -2,764 lines)

### Philosophy
This release focuses on **simplicity and reliability**. By removing the experimental Cursor hooks system and marking Claude Code as experimental, we're being more honest about what's production-ready (Claude Desktop + Cursor .mdc rules) versus what's still evolving (Claude Code automation). The default experience is now cleaner, with advanced features clearly opt-in.

## 0.5.0 - 2025-10-01

### Added
- **Cursor Hooks Integration**: Complete automation hooks system for Cursor IDE
  - `beforeSubmitPrompt` hook - Session initialization + automatic memory recall with context injection
  - `afterFileEdit` hook - Captures significant code changes to memory queue
  - `beforeShellExecution` hook - Audits shell commands (git commits, builds, tests, deploys)
  - `stop` hook - Drains memory queue to AutoMem service at session end
  - Automatic memory recall at conversation start with relevant context injected into AI
  - Smart filtering (skips lock files, node_modules, trivial changes)
  - Non-blocking queue processing in background
  - Comprehensive logging (`~/.cursor/logs/hooks.log`)
- **Hook Templates**:
  - `templates/cursor/hooks/init-session.sh` - Session init + recall (with 2s timeout)
  - `templates/cursor/hooks/capture-edit.sh` - Edit capture with significance scoring
  - `templates/cursor/hooks/audit-shell.sh` - Command auditing (always allows, queues if significant)
  - `templates/cursor/hooks/drain-queue.sh` - Background queue processor
  - `templates/cursor/hooks.json` - Hook configuration for `~/.cursor/hooks.json`
  - `templates/cursor/scripts/memory-filters.json` - Configurable filters and thresholds
- **CLI Enhancement**: Added `--hooks` flag to `cursor` command
  - `npx @verygoodplugins/mcp-automem cursor --hooks` - Installs hooks to `~/.cursor/`
  - Merges with existing `hooks.json` if present (with backup)
  - Copies hook scripts and makes them executable
  - Provides detailed installation feedback and debug information
- **Documentation**:
  - `templates/CURSOR_HOOKS_INTEGRATION.md` - Complete 500+ line guide covering:
    - Architecture and data flow diagrams
    - Hook-by-hook technical reference
    - Configuration and customization
    - Troubleshooting and debugging
    - Advanced usage (custom hooks, gating, multiple hooks per event)
    - Comparison with Claude Code hooks
  - Updated `INSTALLATION.md` with hooks section and verification steps
  - Updated CLI help text with `--hooks` option and examples

### Technical Details
- Cursor hooks use JSON stdin/stdout communication (vs Claude Code's env vars)
- `beforeSubmitPrompt` enables automatic memory recall (impossible in Claude Code)
- Hooks can block/gate operations (Claude Code hooks are fire-and-forget)
- Hook scripts are cross-platform compatible (bash with python3 for JSON parsing)
- Queue format: JSONL (one memory entry per line)
- Importance scoring: 0.5-0.9 based on edit count and chars changed
- Command detection: Pattern matching for git, build, test, deploy, docker

### Performance
- Non-blocking recall (2s timeout to avoid conversation delays)
- Background queue draining (doesn't block session end)
- Filtered processing (skips ~90% of trivial changes)
- Efficient JSON parsing (jq + python3)

### Improvements
- **Verbose logging**: All hooks now log full JSON content of captured memories
  - Users can see exactly what's being stored in `~/.cursor/logs/hooks.log`
  - Helps with debugging and building trust in the automation
  - Shows importance scoring, tags, metadata for each memory
- **Automatic log rotation**: Prevents infinite log file growth
  - Rotates when `hooks.log` exceeds 10MB
  - Keeps one backup (`hooks.log.old`)
  - Maximum disk usage: ~20MB
  - No user configuration required

### Fixed
- **Environment variable inheritance**: Hooks now read `AUTOMEM_ENDPOINT` and `AUTOMEM_API_KEY` from `~/.cursor/mcp.json`
  - Fixes issue where hooks defaulted to localhost instead of using Cursor's configured endpoint
  - Both `init-session.sh` and `drain-queue.sh` now export env vars before calling npx
  - Logs show which endpoint is being used for debugging

## 0.4.0 - 2025-10-01

### Added
- **One-click install for Cursor**: Added install button using Cursor's MCP deeplink protocol
  - Beautiful dark-themed install button with Cursor branding
  - Uses `cursor://anysphere.cursor-deeplink/mcp/install` with base64 encoded config
  - Eliminates manual JSON editing for initial setup
  - Includes detailed "How it works" section with link format breakdown
  - Users configure `AUTOMEM_ENDPOINT` after installation
  - Follows Cursor's official [MCP Install Links](https://cursor.com/docs/context/mcp/install-links) specification
- **Warp Terminal support**: Complete integration for AI-powered terminal assistance with persistent memory
  - Added Warp section to README.md with platform support table
  - Created comprehensive Warp setup guide in INSTALLATION.md
  - Created `templates/warp/` directory with:
    - `warp-rules.md` - Memory-first terminal assistance rules with project auto-detection
    - `mcp.json` - Warp MCP server configuration template
    - `README.md` - Warp-specific setup and usage guide
  - Features:
    - Project context auto-detection from `package.json`, `.git/config`, or directory name
    - Smart memory recall on directory changes and context queries
    - Command history with context awareness
    - Terminal-optimized communication style (terse, command-first)
    - Memory storage for setup commands, debugging patterns, and deployment procedures
    - Cross-platform memory sync (Warp ↔ Cursor ↔ Claude Code ↔ Claude Desktop)
- Added Warp troubleshooting section to INSTALLATION.md
- Screenshots demonstrating Warp + AutoMem in action

### Documentation
- **Consolidated documentation structure**: Single source of truth approach
  - All platform setup instructions in INSTALLATION.md
  - Removed redundant template READMEs (templates/warp/README.md, templates/codex/README.md)
  - Added helpful inline comments to template config files
  - Kept templates/CLAUDE_CODE_INTEGRATION.md as technical deep-dive for complex hook system
- Updated README.md platform support table to include Warp Terminal and OpenAI Codex
- **Warp Terminal support**: Complete integration guide in INSTALLATION.md
  - AI rules template with project auto-detection
  - Memory-first terminal assistance patterns
  - Template files with inline documentation
- **OpenAI Codex support**: Complete setup guide in INSTALLATION.md
  - TOML configuration format (`~/.codex/config.toml`)
  - Template with inline comments and examples
  - CLI, IDE extension, and cloud agent usage
  - GitHub integration workflow
  - Cross-platform memory sync

## 0.3.1 - 2025-10-01

### Security & Privacy
- **Removed public AutoMem endpoint** from all templates and default configuration
- Changed default endpoint to `localhost:8001` (users must deploy their own instance)
- Updated all template files to use placeholder URLs (`your-automem-instance.railway.app`)
- Ensures no shared/public endpoints are inadvertently used

### Documentation
- Split documentation into marketing-focused `README.md` and technical `INSTALLATION.md`
- Fixed all internal documentation links (removed non-existent `CURSOR_SETUP.md` references)
- Added `automem.ai` domain references throughout documentation
- Clarified separation between MCP client (this package) and AutoMem service (backend)

### Changed
- Updated config templates to require explicit endpoint configuration
- Improved template placeholder clarity for user customization

## 0.3.0 - 2025-10-01

### Added
- **Cursor IDE support**: New `cursor` command for project-level setup with `.cursor/rules/` agent files
  - `npx @verygoodplugins/mcp-automem cursor` - Sets up memory-first development workflow
  - Supports `--dry-run`, `--dir`, `--name`, `--desc` options
  - Creates `.cursorrules` and `.cursor/rules/` directory with memory-keeper and project-assistant agents
- **Migration tool**: `migrate` command to convert between manual/cursor configurations
- **Uninstall tool**: `uninstall cursor` command to cleanly remove Cursor setup
- **Global user rules guide**: README now includes optional prompt for Cursor Settings > General > Rules for AI

### Fixed
- **Cross-platform compatibility**: Claude Desktop config path now supports macOS, Windows, and Linux
- **CLI argument validation**: Added bounds checking and error messages for all CLI parsers
- **Logical operator precedence**: Fixed search condition in migrate.ts to require "memory" AND ("store" OR "recall")
- **Logging accuracy**: File existence check now tracks state before write operation

### Changed
- Removed experimental global installation code (database injection approach)
- Improved CLI error messages with actionable feedback
- Updated README with clearer installation guidance and global setup instructions

### Documentation
- Added `INSTALLATION.md` with comprehensive platform-specific setup guides
- Enhanced README with marketing-focused content and global user rules section
- Updated help text to reference README for global configuration

## 0.2.0 - 2025-09-30

Enhancements
- recall_memory: When `tags` are provided, merge results from `/recall` and `/memory/by-tag` for stronger coverage (dedupe by ID, sort by score, enforce `limit`).
- recall_memory: Added optional `tag_mode` (`any|all`) and `tag_match` (`exact|prefix`) parameters; forwarded to the AutoMem service when present.
- Client: Surfaces `tag_mode` and `tag_match` in results for clarity.
- Claude Code integration: Introduced profiles and lean defaults.
  - New CLI option: `npx @verygoodplugins/mcp-automem claude-code --profile <lean|extras>`.
  - Lean profile: quiet defaults, high-signal hooks only (git commit, build) and queue drain on Stop.
  - Extras profile: optional hooks (edit/test/deploy/search/error) and optional status line.
- Templates and docs: Sanitized project examples; added guidance for enabling optional hooks and customizing filters.
 - Templates: Standardized event time as top-level `timestamp` in hook outputs; removed month tags from default capture to avoid redundant time signals.

Changes
- Removed deprecated `search_by_tag` tool and handler; use `recall_memory` with `tags` (the MCP server now merges `/memory/by-tag` results automatically when tags are provided).

Notes
- Upstream recommendation: Update AutoMem `/recall` to apply tag filters at search-time in the vector branch using Qdrant `query_filter`, support `tag_mode` and `tag_match`, and add a tags-only fallback. This MCP already passes these parameters and will benefit automatically once deployed.

## 0.1.0 - 2025-09-22

Initial release
- MCP server exposing core AutoMem tools:
  - `store_memory`, `recall_memory`, `associate_memories`, `update_memory`, `delete_memory`, `check_database_health`.
- Node client wrapper for the AutoMem API.
- Baseline docs and quick start.
### Added
- **OpenAI Codex proactive rules + installer**:
  - New `codex` CLI command to install memory-first rules into `AGENTS.md`
  - Template: `templates/codex/memory-rules.md` with project/month variables
  - Example config: `templates/codex/config.toml`
  - Goal: give Codex similar proactive recall/store behavior as Cursor’s `.mdc` rules
