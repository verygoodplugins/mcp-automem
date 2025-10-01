# MCP AutoMem Server

[![Version](https://img.shields.io/npm/v/@verygoodplugins/mcp-automem)](https://www.npmjs.com/package/@verygoodplugins/mcp-automem)
[![License](https://img.shields.io/npm/l/@verygoodplugins/mcp-automem)](LICENSE)

A Model Context Protocol (MCP) server for AutoMem, enabling AI assistants to store, recall, and associate memories using FalkorDB (graph) and Qdrant (vector search).

## Features

- 🧠 **Memory Storage** - Store structured memories with content, tags, and importance scores
- 🔍 **Smart Recall** - Retrieve memories using text search, semantic search, or both
- 🔗 **Memory Associations** - Create relationships between memories with different types and strengths
- 📊 **Health Monitoring** - Check the status of FalkorDB and Qdrant connections
- 🌐 **Flexible Deployment** - Works with local AutoMem service or remote Railway deployment
- ⚡ **Real-time** - Direct integration with your AutoMem service

## Quick Start

### Assisted Setup (Recommended)

Run the guided setup to write your `.env` file and print the config snippet for Claude clients:

```bash
npx @verygoodplugins/mcp-automem setup
```

The wizard will:

- Prompt for the AutoMem endpoint and API key
- Update (or create) a `.env` file in the current directory
- Show copy-paste snippets for Claude Desktop and Claude Code
- Add `--claude-code` to run the environment wizard and install Claude Code automation in one step

#### Add Cursor AutoMem Setup

To set up AutoMem for Cursor with automatic memory-first development:

```bash
npx @verygoodplugins/mcp-automem cursor
```

This command:

- Auto-detects your project name and description
- Creates `.cursor/rules/` with memory agent configurations
- Installs `.cursorrules` with memory-first patterns
- Checks your Claude Desktop config for memory server
- Provides setup guidance if memory server is missing

**Installation Options:**

```bash
# Project-specific install (recommended)
npx @verygoodplugins/mcp-automem cursor

# Specify project details manually
npx @verygoodplugins/mcp-automem cursor --name my-project --desc "My awesome project"

# Preview changes without modifying files
npx @verygoodplugins/mcp-automem cursor --dry-run

# Custom target directory
npx @verygoodplugins/mcp-automem cursor --dir .cursor/rules
```

**Global User Rules (Optional):**

For memory-first behavior across ALL Cursor projects, you can add this prompt to `Cursor Settings > General > Rules for AI`:

```markdown
## Memory-First Development

At the start of EVERY conversation, recall relevant memories:

mcp_memory_recall_memory({
  query: "<describe the user's current task or question>",
  tags: ["<project-name>", "cursor"],  // Auto-detect project name from package.json, git, or directory
  limit: 5
})

During conversation, store important discoveries:
- Architectural decisions → importance: 0.9, tags: ["<project-name>", "decision", "architecture"]
- Bug fixes with root cause → importance: 0.8, tags: ["<project-name>", "bug-fix", "<component>"]
- Useful patterns → importance: 0.7, tags: ["<project-name>", "pattern", "<type>"]

Always use the current project's name in tags for organization.
```

This enables basic memory recall/storage globally without needing per-project setup. For full agent features (priority, automatic tool selection), use project-level installation.

#### Add Claude Code Automation Hooks

To install the capture hooks and queue processor that automatically write memories from Claude Code sessions, run:

```bash
npx @verygoodplugins/mcp-automem claude-code
```

This command:

- Installs/updates `~/.claude/hooks/*.sh` and supporting scripts under `~/.claude/scripts`
- Merges the required tool permissions and hook definitions into `~/.claude/settings.json`
- Adds a session-stop hook that drains the memory queue via `npx @verygoodplugins/mcp-automem queue`

Choose a profile during setup (optional):

```bash
# Quiet defaults (recommended)
npx @verygoodplugins/mcp-automem claude-code --profile lean

# Enable additional hooks (edit/test/deploy/search/error) and status line
npx @verygoodplugins/mcp-automem claude-code --profile extras
```

Profiles:
- Lean (default): Installs a quiet setup that only captures build results and a single session milestone, then drains the queue on Stop.
- Extras (optional): Enables additional hooks (edit/test/deploy/search/error) and optional status line. See `templates/claude-code/profiles/`.

To use a profile instead of the default, copy it to your Claude settings and edit as needed:

```bash
# Lean profile (quiet, recommended)
cp templates/claude-code/profiles/settings.lean.json ~/.claude/settings.json

# Extras profile (more hooks, more capture)
cp templates/claude-code/profiles/settings.extras.json ~/.claude/settings.json
```

Customize filters for best results:
- Edit `~/.claude/scripts/memory-filters.json` (template at `templates/claude-code/scripts/memory-filters.json`).
- Tune `project_importance` (placeholders provided), `file_weight`, and thresholds to match your workflow.

Use `--dry-run` to preview changes or `--dir <path>` to target a custom Claude configuration directory.

### Installation Methods

#### Option 1: Using NPX (No Installation Required)

The simplest way - no need to install anything globally:

```bash
# For Claude Desktop
npx @verygoodplugins/mcp-automem

# For Claude Code
claude mcp add automem "npx @verygoodplugins/mcp-automem"
```

#### Option 2: Global Installation

Install once, use anywhere:

```bash
# Install globally
npm install -g @verygoodplugins/mcp-automem

# For Claude Code
claude mcp add automem "mcp-automem"
```

#### Option 3: Local Development

For contributing or customization:

```bash
# Clone and install
git clone https://github.com/verygoodplugins/mcp-automem.git
cd mcp-automem
npm install
npm run build
```

## Configuration

### 1. Set Up AutoMem Service

You need a running AutoMem service. You can either:

- **Local Development**: Run `make dev` in your AutoMem project to start FalkorDB + Qdrant + API
- **Railway Deployment**: Use your deployed AutoMem service URL

### 2. Configure Your Client

<details>
<summary><b>Claude Desktop Configuration</b></summary>

**macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`  
**Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "automem": {
      "command": "npx",
      "args": ["@verygoodplugins/mcp-automem"],
      "env": {
        "AUTOMEM_ENDPOINT": "https://automem.up.railway.app",
        "AUTOMEM_API_KEY": "your-auto-mem-api-key"
      }
    }
  }
}
```

**For local development:**
```json
{
  "mcpServers": {
    "automem": {
      "command": "npx",
      "args": ["@verygoodplugins/mcp-automem"],
      "env": {
        "AUTOMEM_ENDPOINT": "http://127.0.0.1:8001",
      }
    }
  }
}
```

</details>

<details>
<summary><b>Cursor IDE Configuration</b></summary>

Add to your MCP config file (e.g., `.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "automem": {
      "command": "npx",
      "args": ["@verygoodplugins/mcp-automem"],
      "env": {
        "AUTOMEM_ENDPOINT": "https://automem.up.railway.app",
        "AUTOMEM_API_KEY": "your-auto-mem-api-key"
      }
    }
  }
}
```

**Or if installed locally:**
```json
{
  "mcpServers": {
    "automem": {
      "command": "node",
      "args": ["/Users/your-path/mcp-servers/mcp-automem/dist/index.js"],
      "env": {
        "AUTOMEM_ENDPOINT": "https://automem.up.railway.app"
      }
    }
  }
}
```

</details>

### 3. Environment Variables

Create a `.env` file for local development (or re-run `npx @verygoodplugins/mcp-automem setup` to update it):

```env
# Required: AutoMem service endpoint
AUTOMEM_ENDPOINT=https://automem.up.railway.app

# Optional: API key (if your service requires authentication)
AUTOMEM_API_KEY=your_api_key_here

```

Template config files are available under [`templates/`](templates/) if you prefer to copy them manually. You can also print the snippets again at any time with:

```bash
npx @verygoodplugins/mcp-automem config --format=json
```

### Claude Code Integration (Highly Recommended)

AutoMem provides deep Claude Code integration with automatic memory capture hooks and intelligent context loading.

**📖 [Complete Integration Guide](templates/CLAUDE_CODE_INTEGRATION.md)**

This comprehensive guide covers:
- How the hook system captures memories automatically
- What files get modified during installation
- Memory queue and processing pipeline
- All 11 relationship types and their uses
- Expected behavior and troubleshooting
- Importance scoring and consolidation cycles

**Quick Start:**

1. **Install hooks and memory rules:**
   ```bash
   npx @verygoodplugins/mcp-automem claude-code
   cat templates/CLAUDE_MD_MEMORY_RULES.md >> ~/.claude/CLAUDE.md
   ```

2. **What gets installed:**
   - Hook scripts in `~/.claude/hooks/` (captures events)
   - Support scripts in `~/.claude/scripts/` (processes memories)
   - Merged settings in `~/.claude/settings.json` (configures permissions)
   - Memory rules in `~/.claude/CLAUDE.md` (teaches Claude)

**What You Get:**
- ✅ Automatic memory capture (commits, builds, errors, patterns)
- ✅ Session context loading (project history, preferences, errors)
- ✅ Knowledge graph building (11 relationship types)
- ✅ Hybrid search (vector + keyword + tags + recency)
- ✅ Importance scoring and consolidation cycles

**Quick Links:**
- [Integration Guide](templates/CLAUDE_CODE_INTEGRATION.md) - Complete setup and how it works
- [Memory Rules Template](templates/CLAUDE_MD_MEMORY_RULES.md) - AI instructions for CLAUDE.md
- [Hook Configuration](templates/claude-code/settings.json) - Example settings.json

### Queue Processor (Optional)

If you disable the automatic hook, you can manually flush the queue whenever you like:

```bash
npx @verygoodplugins/mcp-automem queue --file ~/.claude/scripts/memory-queue.jsonl
```

## Additional Commands

### Migration

Migrate existing projects to AutoMem:

```bash
# Migrate from manual memory usage to Cursor
npx @verygoodplugins/mcp-automem migrate --from manual --to cursor

# Migrate from manual to Claude Code
npx @verygoodplugins/mcp-automem migrate --from manual --to claude-code

# Preview migration without changes
npx @verygoodplugins/mcp-automem migrate --from manual --to cursor --dry-run
```

### Uninstall

Remove AutoMem configuration:

```bash
# Uninstall Cursor AutoMem
npx @verygoodplugins/mcp-automem uninstall cursor

# Uninstall Claude Code AutoMem
npx @verygoodplugins/mcp-automem uninstall claude-code

# Also clean Claude Desktop memory server config
npx @verygoodplugins/mcp-automem uninstall cursor --clean-all

# Preview what would be removed
npx @verygoodplugins/mcp-automem uninstall cursor --dry-run
```

### Help

View all available commands:

```bash
npx @verygoodplugins/mcp-automem help
```

## Available Tools

### Memory Management

#### `store_memory`
Store a new memory with optional metadata.

**Parameters:**
- `content` (required): The memory content to store
- `tags` (optional): Array of tags to categorize the memory
- `importance` (optional): Importance score between 0 and 1
- `embedding` (optional): Embedding vector for semantic search

**Example:**
```
Store this memory: "Completed the AutoMem MCP server integration" with tags ["development", "mcp"] and importance 0.8
```

#### `recall_memory`
Retrieve memories using text, semantic search, time, and tag filters.

**Parameters:**
- `query` (optional): Text query to search for in memory content
- `embedding` (optional): Embedding vector for semantic similarity search
- `limit` (optional): Maximum number of memories to return (default: 5, max: 50)
- `time_query` (optional): Natural time window like `today`, `last week`, `last 7 days`
- `start` (optional): ISO timestamp lower bound
- `end` (optional): ISO timestamp upper bound
- `tags` (optional): Array of tags to filter by (e.g. `["slack", "slack/channel-ops"]`)
- `tag_mode` (optional): `any` (default) or `all` — require any vs all of the provided tags
- `tag_match` (optional): `exact` (default) or `prefix` — whether tag matching must be exact or can match prefixes (e.g., `slack` matches `slack/*`)

Notes:
- When `tags` are provided, the MCP server passes `tags`, `tag_mode`, and `tag_match` through to `/recall`. It also augments results by fetching exact tag matches from `/memory/by-tag` and merging them for better coverage.
- For tags that act like namespaces (e.g. `slack/channel-ops`), prefer the precise tag for targeted recall. Use `tag_match: "prefix"` to widen matches (requires upstream support).

**Examples:**
```
Recall memories about "MCP server development"
```

```
Recall memories tagged with "slack/channel-ops"
```

```
Recall memories about "handoff" tagged with "slack"
```

#### `associate_memories`
Create relationships between memories.

**Parameters:**
- `memory1_id` (required): ID of the first memory
- `memory2_id` (required): ID of the second memory
- `type` (required): Relationship type (see below)
- `strength` (required): Association strength between 0 and 1

**Relationship Types:**
- `RELATES_TO` - General connection
- `LEADS_TO` - Causal relationship (e.g., bug → solution)
- `OCCURRED_BEFORE` - Temporal sequence
- `PREFERS_OVER` - User/team preferences
- `EXEMPLIFIES` - Pattern examples
- `CONTRADICTS` - Conflicting approaches
- `REINFORCES` - Supporting evidence
- `INVALIDATED_BY` - Outdated information
- `EVOLVED_INTO` - Knowledge evolution
- `DERIVED_FROM` - Source relationships
- `PART_OF` - Hierarchical structure

**Example:**
```
Associate memory abc123 with memory def456 using LEADS_TO relationship with strength 0.9
```

### System Monitoring

#### `check_database_health`
Check the health status of the AutoMem service and its databases.

**Example:**
```
Check the health of the AutoMem service
```

## Usage Examples

### Basic Memory Operations
```
Store a memory about completing the project documentation
```

### Smart Recall
```
Find all memories related to "database optimization" from the last month
```

### Memory Associations
```
Create a relationship between the two most recent memories about the same project
```

### System Health
```
Check if the AutoMem service and databases are running properly
```

## Development

### Building from Source

```bash
npm install
npm run build
```

### Development Mode

```bash
npm run dev  # Watch mode with auto-reload
```

### Testing

```bash
npm test
```

## Architecture

The MCP server acts as a bridge between MCP clients (like Claude Desktop/Cursor) and your AutoMem service:

```
MCP Client ↔ MCP AutoMem Server ↔ AutoMem Service ↔ FalkorDB + Qdrant
```

- **MCP Client**: Claude Desktop, Cursor, etc.
- **MCP AutoMem Server**: This TypeScript server (native MCP protocol)
- **AutoMem Service**: Your Python Flask API
- **Storage**: FalkorDB (graph) + Qdrant (vectors)

## Troubleshooting

### Connection Issues

#### Service unreachable
- Verify `AUTOMEM_ENDPOINT` is correct and accessible
- Check if AutoMem service is running (`/health` endpoint should return 200)
- Ensure no firewall blocking the connection

#### Authentication errors
- Check if `AUTOMEM_API_KEY` is required and properly set
- Verify API key has appropriate permissions

### Memory Issues

#### No memories returned
- Verify memories exist in the database
- Check query parameters and filters
- Ensure embeddings are properly generated if using semantic search

#### Storage failures
- Check FalkorDB and Qdrant connections via health endpoint
- Verify content doesn't exceed size limits
- Ensure proper data formatting

## Contributing

Contributions are welcome! Please:

1. Fork the repository
2. Create a feature branch
3. Make your changes with tests
4. Submit a pull request

## License

MIT - See [LICENSE](LICENSE) file for details.

## Support

- **Issues**: [GitHub Issues](https://github.com/verygoodplugins/mcp-automem/issues)
- **AutoMem**: [AutoMem Repository](https://github.com/verygoodplugins/automem)

## Credits

Built by [Jack Arturo](https://x.com/verygoodplugins) 🧡

- Powered by [AutoMem](https://github.com/verygoodplugins/automem)
- Built with [Model Context Protocol SDK](https://github.com/anthropics/model-context-protocol)
- Part of the [Very Good Plugins](https://verygoodplugins.com) MCP ecosystem
