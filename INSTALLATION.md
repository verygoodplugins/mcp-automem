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
- [Warp Terminal](#warp-terminal)
- [OpenAI Codex](#openai-codex)

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

### 1. One-Click Install (Fastest)

Click to install AutoMem MCP server in Cursor:

<a href="cursor://anysphere.cursor-deeplink/mcp/install?name=automem&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyJAdmVyeWdvb2RwbHVnaW5zL21jcC1hdXRvbWVtIl0sImVudiI6eyJBVVRPTUVNX0VORFBPSU5UIjoiaHR0cHM6Ly95b3VyLWF1dG9tZW0taW5zdGFuY2UucmFpbHdheS5hcHAiLCJBVVRPTUVNX0FQSV9LRVkiOiJ5b3VyLWFwaS1rZXktaWYtcmVxdWlyZWQifX0=">
  <img src="https://img.shields.io/badge/Install_in_Cursor-000000?style=for-the-badge&logo=data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjQiIGhlaWdodD0iMjQiIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHBhdGggZD0iTTEyIDJMMiAyMkgyMkwxMiAyWiIgZmlsbD0id2hpdGUiLz4KPC9zdmc+" alt="Install in Cursor" />
</a>

**What this does:**
- Opens Cursor with install prompt
- Automatically adds AutoMem to your Claude Desktop MCP config
- No manual JSON editing required!

**After installation:**
- Update `AUTOMEM_ENDPOINT` with your AutoMem instance URL
- Optionally set `AUTOMEM_API_KEY` if using authentication
- Restart Cursor to load the server

**Config location:**
- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`
- Linux: `~/.config/Claude/claude_desktop_config.json`

<details>
<summary><b>📋 How the install link works</b></summary>

The install button uses Cursor's MCP deeplink protocol:

```
cursor://anysphere.cursor-deeplink/mcp/install?name=automem&config=BASE64_CONFIG
```

**Format breakdown:**
- `cursor://anysphere.cursor-deeplink/mcp/install` - Cursor's MCP install handler
- `name=automem` - MCP server name
- `config=BASE64_CONFIG` - Base64 encoded JSON configuration

**Configuration being installed:**
```json
{
  "command": "npx",
  "args": ["@verygoodplugins/mcp-automem"],
  "env": {
    "AUTOMEM_ENDPOINT": "https://your-automem-instance.railway.app",
    "AUTOMEM_API_KEY": "your-api-key-if-required"
  }
}
```

Learn more: [Cursor MCP Install Links](https://cursor.com/docs/context/mcp/install-links)

**Want to use this in your own README?**

Markdown:
```markdown
<a href="cursor://anysphere.cursor-deeplink/mcp/install?name=automem&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyJAdmVyeWdvb2RwbHVnaW5zL21jcC1hdXRvbWVtIl0sImVudiI6eyJBVVRPTUVNX0VORFBPSU5UIjoiaHR0cHM6Ly95b3VyLWF1dG9tZW0taW5zdGFuY2UucmFpbHdheS5hcHAiLCJBVVRPTUVNX0FQSV9LRVkiOiJ5b3VyLWFwaS1rZXktaWYtcmVxdWlyZWQifX0=">
  <img src="https://img.shields.io/badge/Install_in_Cursor-000000?style=for-the-badge" alt="Install in Cursor" />
</a>
```

</details>

### 2. Automated Setup with Agent Rules (Recommended)

For complete setup with memory-first agent rules, run:

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

### 2.5. Install Automation Hooks (Optional but Recommended)

Enable **automatic memory capture** throughout your coding session:

```bash
npx @verygoodplugins/mcp-automem cursor --hooks
```

This installs hooks to `~/.cursor/`:

**Hook Flow**:
1. **Session Start** (`beforeSubmitPrompt`) - Recalls relevant memories, injects context into AI
2. **Code Changes** (`afterFileEdit`) - Queues significant edits
3. **Shell Commands** (`beforeShellExecution`) - Audits git commits, builds, deploys
4. **Session End** (`stop`) - Drains queue to AutoMem

**What Gets Installed**:
```
~/.cursor/
├── hooks.json                    # Hook configuration
├── hooks/
│   ├── init-session.sh          # Session init + memory recall
│   ├── capture-edit.sh          # File edit capture
│   ├── audit-shell.sh           # Shell command audit
│   └── drain-queue.sh           # Queue processor
├── scripts/
│   └── memory-filters.json      # Filters (skip lock files, etc.)
└── logs/
    └── hooks.log                # Hook execution logs
```

**Verify Installation**:
1. Restart Cursor
2. Open Cursor Settings > Hooks tab
3. Verify 4 hooks are listed
4. Check logs: `tail -f ~/.cursor/logs/hooks.log`

**Example Session with Hooks**:
```
User: "Add authentication to the API"

Hook injects context:
📚 Context from previous sessions:
1. You chose JWT tokens for auth (importance: 0.8)
2. Use bcrypt for password hashing (importance: 0.9)

[AI codes with this context...]

Hook captures:
✓ Edited src/auth/UserAuth.ts (5 changes, 342 chars)
✓ Executed: npm test (queued as test run)

Session ends:
✓ Draining 12 memories to AutoMem
```

👉 **[Full Hooks Guide](../templates/CURSOR_HOOKS_INTEGRATION.md)** - Architecture, troubleshooting, advanced usage

### 3. Configure Environment Variables

After one-click install or CLI setup, update the AutoMem configuration:

Edit Claude Desktop config (Cursor uses Claude Desktop's MCP servers):

**macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`  
**Windows**: `%APPDATA%\Claude\claude_desktop_config.json`  
**Linux**: `~/.config/Claude/claude_desktop_config.json`

Update the `env` section:
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

Restart Claude Desktop/Cursor after updating the config.

### 4. Global User Rules (Optional)

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

## Warp Terminal

Warp's MCP integration enables AI-powered terminal assistance with persistent memory. Your AI assistant remembers project setups, common commands, debugging patterns, and past solutions.

### 1. Configure MCP Server

Add AutoMem to your Warp MCP configuration:

**macOS/Linux**: `~/.warp/mcp.json`  
**Windows**: `%USERPROFILE%\.warp\mcp.json`

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

### 2. Add AI Rules

Configure Warp's AI assistant to use memory-first patterns.

Open Warp → Settings (⌘,) → Features → Warp AI → Custom Instructions

Add the following rules:

```markdown
# Memory-First Terminal Assistance

## Project Context Detection (CRITICAL)

When the user:
- Changes directory to a new project (`cd`, `z`, etc.)
- Asks "where am I?" or "what is this project?"
- Requests help without prior context
- Starts debugging or running commands in unfamiliar code

**IMMEDIATELY recall project memories:**

```javascript
mcp_memory_recall_memory({
  query: "project overview architecture setup common commands",
  tags: ["<detect-project-name>", "warp", "terminal"],
  limit: 5
})
```

## Auto-Detect Project Name

Extract from (in order):
1. `package.json` → `name` field
2. `.git/config` → remote origin repo name  
3. Current directory name as fallback

Use this as the primary tag for all memory operations.

## When to Store Memories

**High Priority (importance: 0.9)**
- Setup commands that worked (especially complex ones)
- Environment variable configurations
- Build/deploy procedures that succeeded after debugging
- Critical file locations and their purposes

**Medium Priority (importance: 0.7-0.8)**
- Common debugging patterns that worked
- Useful aliases or scripts created
- Dependencies and version requirements
- Test command sequences

**Low Priority (importance: 0.5-0.6)**
- Frequently used commands in this project
- Directory navigation shortcuts
- Log file locations

## Memory Tagging for Terminal Context

ALWAYS include:
- Project name (auto-detected)
- `warp` - Platform identifier
- `terminal` - Context type
- `YYYY-MM` - Current month
- Command type: `setup`, `debug`, `build`, `deploy`, `test`

## Smart Context Triggers

Recall memories when user asks:
- "How do I start/run/build this?"
- "What commands are available?"
- "Why isn't X working?"
- "Where is the Y file?"
- "What environment variables do I need?"
- Shows error output without explanation
- Types `git clone` or `npm install` (new project setup)

## Communication Style

- **Be terse**: Terminal users want answers fast
- **Command-first**: Lead with the command, explanation after
- **One-liners preferred**: Use `&&` chains when safe
- **Flag dangerous commands**: Warn about `rm -rf`, force pushes, etc.
- **Copy-pastable**: Format commands in code blocks

## Auto-store After Success

When user successfully:
- Fixes an error → Store solution with error message as context
- Runs complex command → Store with description
- Completes setup → Store complete sequence
- Discovers useful tool → Store with use case

**Auto-store format:**
```javascript
mcp_memory_store_memory({
  content: "[What worked] in [project-name]: [command/solution]. Context: [why it was needed]",
  tags: ["<project>", "warp", "terminal", "<YYYY-MM>", "<type>"],
  importance: 0.7-0.9
})
```
```

### 3. Restart Warp

Close and reopen Warp terminal to load the MCP server.

### 4. Verify Installation

In any Warp session, type or ask:

```
Check the health of the AutoMem service
```

You should see connection status for FalkorDB and Qdrant.

### 5. Test Project Context

Navigate to a project and ask:

```
what's happened in this project this week?
```

The AI should:
- Detect your current project name
- Recall relevant memories
- Show git history
- Display recent changes

### How It Works

**Smart Project Detection:**
- Warp AI auto-detects project name from `package.json`, `.git/config`, or directory name
- Automatically recalls project-specific memories when you `cd` into projects
- Tags all memories with project context for easy filtering

**Context-Aware Assistance:**
- Remembers setup commands you've run before
- Recalls debugging solutions from past sessions
- Knows your project's common workflows
- Suggests commands based on project history

**Example Workflow:**

```bash
# You navigate to a project
cd ~/Projects/my-api

# Ask about the project
what is this project?

# AI recalls: "my-api (REST API with Node.js + PostgreSQL)
# Common commands: npm run dev (port 3000), npm test
# Last deployed: v2.1.0 (Railway). Database: Heroku Postgres."

# Hit an error
npm run build
# Error: Missing env var DATABASE_URL

# Ask for help
how do I fix this?

# AI recalls: "You need DATABASE_URL from .env.example.
# Copy: cp .env.example .env, then fill in Heroku credentials.
# (This came up before in commit abc123f)"
```

### Memory Management Tips

**Best Practices:**
- Let the AI auto-detect project names (don't override unless necessary)
- Store memories after successful troubleshooting
- Use consistent importance scores (0.9 for critical setup, 0.7 for common commands)
- Tag memories with command types (`setup`, `debug`, `deploy`)

**Cleaning Up:**
- Old memories automatically decay in importance
- Use `delete_memory` to remove obsolete info
- Update memories when procedures change

### Advanced Configuration

**Custom Project Detection:**

If auto-detection doesn't work for your project structure:

```javascript
// Manually recall with explicit project name
mcp_memory_recall_memory({
  query: "deployment procedure",
  tags: ["my-custom-project-name", "warp", "deploy"],
  limit: 3
})
```

**Integration with Other Tools:**

Combine Warp with other AutoMem platforms:
- Store memories in Warp → Recall in Cursor IDE
- Claude Code hooks → Available in Warp sessions
- Cross-device sync (same memories on all machines)

See **[Memory Tagging Best Practices](#memory-tagging-for-terminal-context)** in the AI rules above.

---

## OpenAI Codex

OpenAI Codex is an AI coding assistant with CLI, IDE, and cloud agent support. AutoMem enables Codex to remember project context, coding patterns, and past decisions.

### 1. Install Codex CLI

If you haven't already, install Codex:

```bash
# Using npm
npm install -g @openai/codex

# Or using Homebrew (macOS)
brew install codex
```

### 2. Authenticate

```bash
codex
# Sign in with your ChatGPT account when prompted
# Requires ChatGPT Plus, Pro, Team, Edu, or Enterprise
```

### 3. Configure MCP Server

Add AutoMem to your Codex configuration file.

**Config location:** `~/.codex/config.toml`

Add the following to your `config.toml`:

```toml
[mcp_servers.automem]
command = "npx"
args = ["@verygoodplugins/mcp-automem"]

[mcp_servers.automem.env]
AUTOMEM_ENDPOINT = "https://your-automem-instance.railway.app"
AUTOMEM_API_KEY = "your-api-key-if-required"
```

**For local development:**
```toml
[mcp_servers.automem]
command = "npx"
args = ["@verygoodplugins/mcp-automem"]

[mcp_servers.automem.env]
AUTOMEM_ENDPOINT = "http://127.0.0.1:8001"
```

**Using local build (for development):**
```toml
[mcp_servers.automem]
command = "/opt/homebrew/bin/node"  # or "/usr/bin/node" on Linux
args = ["/path/to/mcp-automem/dist/index.js"]

[mcp_servers.automem.env]
AUTOMEM_ENDPOINT = "https://your-automem-instance.railway.app"
AUTOMEM_API_KEY = "your-api-key"
```

### 4. Restart Codex

Restart the Codex CLI or reload your IDE extension to load the MCP server.

### 5. Verify Installation

Ask Codex:
```
Check the health of the AutoMem service
```

You should see connection status for FalkorDB and Qdrant.

### How to Use with Codex

**In the CLI:**
```bash
cd ~/Projects/my-app

# Ask Codex to use memory
codex "What were the key decisions made in this project last week?"
```

**In the IDE:**
- Open Codex panel in your editor
- Ask questions that leverage memory
- Codex will automatically use AutoMem tools when relevant

**In Cloud Agent:**
- Launch tasks from [chatgpt.com/codex](https://chatgpt.com/codex)
- Codex has access to stored memories across environments
- Memories sync between CLI, IDE, and cloud agent

### Memory Best Practices for Codex

**Tag memories with project context:**
```javascript
mcp_memory_store_memory({
  content: "Implemented OAuth flow using NextAuth.js in my-app",
  tags: ["my-app", "codex", "auth", "nextauth", "2025-10"],
  importance: 0.8
})
```

**Store architectural decisions:**
```javascript
mcp_memory_store_memory({
  content: "Decided to use server components for data fetching in Next.js 14. Reason: Better performance and SEO.",
  tags: ["my-app", "codex", "architecture", "nextjs", "2025-10"],
  importance: 0.9
})
```

**Recall context when switching projects:**
```javascript
mcp_memory_recall_memory({
  query: "setup instructions deployment process",
  tags: ["my-app", "codex"],
  limit: 5
})
```

### Integration with GitHub

Since Codex integrates with GitHub repositories:
- Memories persist across branches
- Track decisions made during PRs
- Remember why code was written a certain way
- Recall past discussions about implementations

**Example workflow:**
1. Codex analyzes PR and stores key decisions
2. Future coding sessions recall those decisions
3. Consistent implementation across team members

### Cross-Platform Memory Sync

Memories stored in Codex are available in:
- Cursor IDE (via AutoMem MCP)
- Claude Code (via AutoMem hooks)
- Claude Desktop (via AutoMem MCP)
- Warp Terminal (via AutoMem MCP)

Use consistent project names and tags across platforms.

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

#### Warp: MCP server not loading
- Check `~/.warp/mcp.json` exists and has valid JSON syntax
- Verify AutoMem endpoint is reachable: `curl $AUTOMEM_ENDPOINT/health`
- Check Warp logs: `tail -f ~/.warp/logs/warp.log` (macOS/Linux)
- Restart Warp completely after config changes

#### Warp: AI not using memory tools
- Verify AI rules are set in Settings → Features → Warp AI → Custom Instructions
- Test with explicit command: "Check the AutoMem service health"
- Ensure project name detection is working: "What project am I in?"

#### Codex: MCP server not loading
- Verify config file exists at `~/.codex/config.toml`
- Check TOML syntax is valid (no missing brackets or quotes)
- Ensure command path is correct (use `which npx` or `which node`)
- Check AutoMem endpoint is accessible: `curl $AUTOMEM_ENDPOINT/health`
- Restart Codex CLI or reload IDE extension
- Ensure you have ChatGPT Plus/Pro/Team/Enterprise subscription

#### Codex: Memory tools not available
- Verify `[mcp_servers.automem]` section exists in config.toml
- Test explicitly: "Check AutoMem database health"
- Check Codex logs for MCP connection errors
- Ensure environment variables are set correctly in `[mcp_servers.automem.env]` section

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

