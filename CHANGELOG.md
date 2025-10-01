# Changelog

All notable changes to this project will be documented in this file.

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
