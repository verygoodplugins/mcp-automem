# Installation Guide

Complete setup instructions for AutoMem MCP across all platforms.

## Prerequisites

You need a running **[AutoMem service](https://github.com/verygoodplugins/automem)** instance. Options:

- **Self-hosted**: Deploy AutoMem service via Docker or Railway ([deployment guide](https://github.com/verygoodplugins/automem#deployment))
- **Local development**: Run `make dev` in AutoMem project (FalkorDB + Qdrant + API)

## Quick Start

### Assisted Setup (Recommended)

Run the guided setup wizard:

```bash
npx @verygoodplugins/mcp-automem setup
```

The wizard will:
- Prompt for your AutoMem endpoint and API key
- Create/update `.env` file in current directory
- Print config snippets for Claude Desktop and Claude Code
- Add `--claude-code` flag to install Claude Code automation in one step

### Platform-Specific Setup

Choose your platform:

- [Claude Desktop](#claude-desktop)
- [Cursor IDE](#cursor-ide)
- [Claude Code](#claude-code)

---

## Claude Desktop

### 1. Install MCP Server

Add AutoMem to your Claude Desktop configuration:

**macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`  
**Windows**: `%APPDATA%\Claude\claude_desktop_config.json`  
**Linux**: `~/.config/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "automem": {
      "command": "npx",
      "args": ["@verygoodplugins/mcp-automem"],
      "env": {
        "AUTOMEM_ENDPOINT": "https://your-automem-instance.railway.app",
        "AUTOMEM_API_KEY": "your-api-key-if-required"
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
        "AUTOMEM_ENDPOINT": "http://127.0.0.1:8001"
      }
    }
  }
}
```

### 2. Restart Claude Desktop

Restart Claude Desktop to load the MCP server.

### 3. Verify Installation

In Claude Desktop, ask:
```
Check the health of the AutoMem service
```

You should see connection status for FalkorDB and Qdrant.

---

## Cursor IDE

### 1. Automated Setup (Recommended)

Run the Cursor setup command:

```bash
npx @verygoodplugins/mcp-automem cursor
```

This will:
- Auto-detect your project name and description
- Create `.cursor/rules/` with memory agent configurations
- Install `.cursorrules` with memory-first patterns
- Check Claude Desktop config for memory server
- Provide setup guidance if memory server is missing

**Options:**
```bash
# Specify project details manually
npx @verygoodplugins/mcp-automem cursor --name my-project --desc "My awesome project"

# Preview changes without modifying files
npx @verygoodplugins/mcp-automem cursor --dry-run

# Custom target directory
npx @verygoodplugins/mcp-automem cursor --dir .cursor/rules
```

See the sections below for detailed Cursor integration options.

### 2. Configure MCP Server

Add to Claude Desktop config (same as above) - Cursor uses Claude Desktop's MCP servers.

### 3. Global User Rules (Optional)

For memory-first behavior across **ALL** Cursor projects, add this to `Cursor Settings > General > Rules for AI`:

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

This enables basic memory recall/storage globally. For full agent features (priority, automatic tool selection), use project-level installation.

---

## Claude Code

### 1. Install Automation Hooks

Run the Claude Code setup:

```bash
npx @verygoodplugins/mcp-automem claude-code
```

This command:
- Installs/updates `~/.claude/hooks/*.sh` and supporting scripts
- Merges tool permissions and hook definitions into `~/.claude/settings.json`
- Adds session-stop hook that drains memory queue automatically

### 2. Choose Profile (Optional)

```bash
# Quiet defaults (recommended)
npx @verygoodplugins/mcp-automem claude-code --profile lean

# Enable additional hooks and status line
npx @verygoodplugins/mcp-automem claude-code --profile extras
```

**Profiles:**
- **Lean** (default): Quiet setup, high-signal hooks only (git commit, build, Stop)
- **Extras**: Optional hooks (edit/test/deploy/search/error) + status line

### 3. Add Memory Rules

Append memory instructions to `~/.claude/CLAUDE.md`:

```bash
cat templates/CLAUDE_MD_MEMORY_RULES.md >> ~/.claude/CLAUDE.md
```

### 4. What Gets Installed

- `~/.claude/hooks/` - Hook scripts (triggered by PostToolUse, Stop)
- `~/.claude/scripts/` - Support scripts (queue processor, filters, notifications)
- `~/.claude/settings.json` - Merged tool permissions and hook config
- `~/.claude/CLAUDE.md` - Memory rules (manual append)

### 5. Customize Filters

Edit `~/.claude/scripts/memory-filters.json` to tune:
- `project_importance` weights
- `file_weight` patterns
- `trivial_patterns` to skip
- `significant_patterns` to capture

See **[Claude Code Integration Guide](templates/CLAUDE_CODE_INTEGRATION.md)** for complete documentation.

---

## Installation Methods

### Option 1: Using NPX (Recommended)

No installation required:

```bash
# For Claude Desktop (in config)
"command": "npx",
"args": ["@verygoodplugins/mcp-automem"]

# For Claude Code
claude mcp add automem "npx @verygoodplugins/mcp-automem"
```

### Option 2: Global Installation

Install once, use anywhere:

```bash
# Install globally
npm install -g @verygoodplugins/mcp-automem

# For Claude Code
claude mcp add automem "mcp-automem"
```

### Option 3: Local Development

For contributing or customization:

```bash
git clone https://github.com/verygoodplugins/mcp-automem.git
cd mcp-automem
npm install
npm run build
```

---

## Configuration

### Environment Variables

Create `.env` file or set in your shell:

```env
# Required: AutoMem service endpoint
AUTOMEM_ENDPOINT=https://your-automem-instance.railway.app

# Optional: API key for authenticated instances
AUTOMEM_API_KEY=your_api_key_here
```

**Note**: Do not use shared/public AutoMem URLs. Deploy your own instance for production use.

### Print Config Snippets

Re-print configuration snippets anytime:

```bash
npx @verygoodplugins/mcp-automem config --format=json
```

---

## MCP Tools

### Memory Management

#### `store_memory`
Store a new memory with optional metadata.

**Parameters:**
- `content` (required): Memory content
- `tags` (optional): Array of tags
- `importance` (optional): Score 0-1
- `metadata` (optional): Additional metadata
- `embedding` (optional): Vector for semantic search

**Example:**
```
Store this memory: "Completed AutoMem MCP integration" with tags ["development", "mcp"] and importance 0.8
```

#### `recall_memory`
Retrieve memories using hybrid search.

**Parameters:**
- `query` (optional): Text search query
- `embedding` (optional): Vector for semantic similarity
- `limit` (optional): Max results (default: 5, max: 50)
- `time_query` (optional): Natural time window (`today`, `last week`, etc.)
- `start` (optional): ISO timestamp lower bound
- `end` (optional): ISO timestamp upper bound
- `tags` (optional): Filter by tags (e.g., `["slack", "slack/channel-ops"]`)
- `tag_mode` (optional): `any` (default) or `all`
- `tag_match` (optional): `exact` or `prefix` (prefix supports namespaces)

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
- `memory1_id` (required): First memory ID
- `memory2_id` (required): Second memory ID
- `type` (required): Relationship type
- `strength` (required): Association strength 0-1

**Relationship Types:**
- `RELATES_TO` - General connection
- `LEADS_TO` - Causal (bug→solution)
- `OCCURRED_BEFORE` - Temporal sequence
- `PREFERS_OVER` - User preferences
- `EXEMPLIFIES` - Pattern examples
- `CONTRADICTS` - Conflicting approaches
- `REINFORCES` - Supporting evidence
- `INVALIDATED_BY` - Outdated info
- `EVOLVED_INTO` - Knowledge evolution
- `DERIVED_FROM` - Source relationships
- `PART_OF` - Hierarchical structure

#### `update_memory`
Update existing memory fields.

**Parameters:**
- `memory_id` (required): Memory to update
- `content` (optional): New content
- `tags` (optional): New tags
- `importance` (optional): New importance score
- `metadata` (optional): New metadata

#### `delete_memory`
Delete a memory and its embedding.

**Parameters:**
- `memory_id` (required): Memory to delete

### System Monitoring

#### `check_database_health`
Check AutoMem service and database status.

**Example:**
```
Check the health of the AutoMem service
```

---

## Additional Commands

### Migration

Migrate existing projects to AutoMem:

```bash
# Migrate from manual memory to Cursor
npx @verygoodplugins/mcp-automem migrate --from manual --to cursor

# Migrate from manual to Claude Code
npx @verygoodplugins/mcp-automem migrate --from manual --to claude-code

# Preview migration without changes
npx @verygoodplugins/mcp-automem migrate --from manual --to cursor --dry-run
```

### Uninstall

Remove AutoMem configuration:

```bash
# Uninstall Cursor setup
npx @verygoodplugins/mcp-automem uninstall cursor

# Uninstall Claude Code setup
npx @verygoodplugins/mcp-automem uninstall claude-code

# Also clean Claude Desktop config
npx @verygoodplugins/mcp-automem uninstall cursor --clean-all

# Preview what would be removed
npx @verygoodplugins/mcp-automem uninstall cursor --dry-run
```

### Queue Processor (Manual)

If you disable automatic hooks, manually process memory queue:

```bash
npx @verygoodplugins/mcp-automem queue --file ~/.claude/scripts/memory-queue.jsonl
```

### Help

View all available commands:

```bash
npx @verygoodplugins/mcp-automem help
```

---

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
- Verify memories exist in database
- Check query parameters and filters
- Ensure embeddings are generated if using semantic search

#### Storage failures
- Check FalkorDB and Qdrant connections via health endpoint
- Verify content doesn't exceed size limits
- Ensure proper data formatting

### Platform-Specific Issues

#### Claude Desktop: MCP server not appearing
- Restart Claude Desktop completely
- Check config file syntax (valid JSON)
- Verify file path is correct for your OS

#### Cursor: Rules not applying
- Reload Cursor window
- Check `.cursor/rules/` files have correct YAML frontmatter
- Verify Claude Desktop MCP config is set up

#### Claude Code: Hooks not triggering
- Check `~/.claude/settings.json` has merged properly
- Verify hook scripts have execute permissions
- Test with `--dry-run` flag first

---

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

---

## Support

- **Documentation**: [automem.ai](https://automem.ai)
- **Issues**: [GitHub Issues](https://github.com/verygoodplugins/mcp-automem/issues)
- **AutoMem Service**: [AutoMem Repository](https://github.com/verygoodplugins/automem)

---

## Credits

Built by [Jack Arturo](https://x.com/verygoodplugins) 🧡

- Powered by [AutoMem](https://github.com/verygoodplugins/automem)
- Built with [Model Context Protocol SDK](https://github.com/anthropics/model-context-protocol)
- Part of the [Very Good Plugins](https://verygoodplugins.com) ecosystem

