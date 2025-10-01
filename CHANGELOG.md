# Changelog

All notable changes to this project will be documented in this file.

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
