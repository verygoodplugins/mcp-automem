# Installation Guide

Complete setup instructions for AutoMem MCP across all platforms.

## Prerequisites

You need a running **[AutoMem service](https://github.com/verygoodplugins/automem)** instance. Options:

- **Local development** (fastest): Run `make dev` in AutoMem project ([instructions](#local-setup))
- **Railway cloud** (recommended for production): Deploy to Railway ([instructions](#railway-deployment))
- **Self-hosted**: Deploy via Docker ([AutoMem repo](https://github.com/verygoodplugins/automem#deployment))

## Quick Start

Follow these three steps:

1. **[Set up AutoMem service](#automem-service-setup)** - Choose local or Railway
2. **[Run setup wizard](#assisted-setup)** - Configure MCP client
3. **[Configure your platform](#platform-specific-mcp-client-setup)** - Claude Desktop, Cursor, etc.

### Assisted Setup (Recommended)

After you have an AutoMem service running, use the guided setup wizard:

```bash
npx @verygoodplugins/mcp-automem setup
```

The wizard will:
- Prompt for your AutoMem endpoint (localhost or Railway URL)
- Prompt for API key (if using Railway)
- Create/update `.env` file in current directory
- Print config snippets for your platform
- Validate connection to AutoMem service

**Example:**
```bash
$ npx @verygoodplugins/mcp-automem setup
? AutoMem Endpoint: http://localhost:8001
? API Key (optional): [leave blank for local]
✓ Connection successful!
✓ Config saved to .env
✓ Claude Desktop config snippet generated
```

---

## AutoMem Service Setup

### Local Setup

**Best for:** Development, testing, single-machine use, or if you prefer privacy.

```bash
# Clone AutoMem service repository
git clone https://github.com/verygoodplugins/automem.git
cd automem

# Start all services (API + FalkorDB + Qdrant)
make dev
```

**What just happened?** Docker Compose started three containers:
- **AutoMem API** at `http://localhost:8001` - Memory storage/retrieval service
- **FalkorDB** at `localhost:6379` - Graph database for memory relationships
- **Qdrant** at `localhost:6333` - Vector database for semantic search

**Verify it's running:**
```bash
curl http://localhost:8001/health
# Expected: {"status": "healthy", "falkordb": "connected"}
```

**Default credentials (local only):**
- No API token required for local development
- Service listens on `127.0.0.1` only (not accessible from network)

**Persistent storage:**
- Memories stored in Docker volumes (survive container restarts)
- To reset: `make clean` (⚠️ deletes all memories)

**Next step:** Use `http://localhost:8001` as your `AUTOMEM_ENDPOINT` when running `npx @verygoodplugins/mcp-automem setup`

---

### Railway Deployment

**Best for:** Production use, multi-device access, team collaboration, always-on availability.

**What is Railway?** Cloud hosting platform where your AutoMem service runs 24/7 in containers.

**Cost breakdown:**
- ✅ **$5 free credits** for 30-day trial (no credit card required)
- ✅ **~$0.50/month** typical AutoMem usage after trial
- ✅ **$1/month minimum** if you use less than that

---

#### Option A: One-Click Deploy ⭐ (Recommended)

[![Deploy on Railway](https://railway.com/button.svg)](https://railway.com/deploy/yD_u9d?referralCode=VuFE6g&utm_medium=integration&utm_source=template&utm_campaign=generic)

**What this does:**
- Creates AutoMem API + FalkorDB services automatically
- Sets up persistent storage and volumes
- Generates secure API tokens (`AUTOMEM_API_TOKEN`, `ADMIN_API_TOKEN`)
- Configures internal networking (`FALKORDB_HOST`, `FALKORDB_PORT`)
- Generates public domain automatically

**After clicking:**
1. Sign in with GitHub (if not logged in)
2. Review environment variables
3. (Optional) Add `OPENAI_API_KEY` for real embeddings instead of mock embeddings
4. Click **"Deploy"**
5. Wait ~60 seconds for deployment to complete ✅

**Next:** Jump to [Step 3: Get Your AutoMem URL](#step-3-get-your-automem-url-1-minute) below to get your endpoint.

---

#### Option B: Manual Setup (Advanced)

<details>
<summary><b>Need more control? Click to expand manual deployment steps</b></summary>

#### Step 1: Create Railway Account (2 minutes)

1. Go to **[railway.app](https://railway.app)**
2. Click **"Start a New Project"** or **"Login"**
3. Sign in with GitHub (create GitHub account first if needed at [github.com](https://github.com))

---

#### Step 2: Deploy AutoMem Service (5 minutes)

AutoMem runs as **two services** on Railway: the API and FalkorDB database.

**2a. Create New Project**

1. After logging in, click **"New Project"**
2. Choose **"Deploy from GitHub repo"**

**2b. Connect GitHub Repository**

1. Click **"Configure GitHub App"**
2. Install Railway app to your GitHub account
3. Fork **[verygoodplugins/automem](https://github.com/verygoodplugins/automem)** (top right, click "Fork")
4. Back in Railway, select **your fork** of automem
5. Click **"Deploy Now"**

**2c. Add FalkorDB Database**

Railway will deploy the AutoMem API automatically. Now add the database:

1. In your project, click **"+ New"** → **"Empty Service"**
2. In the new service settings:
   - **Name:** `falkordb`
   - **Source:** Docker image
   - **Image:** `falkordb/falkordb:latest`
3. Click **"Deploy"**

**2d. Configure AutoMem API Environment Variables**

1. Click on your **automem** service (not falkordb)
2. Go to **"Variables"** tab
3. Click **"+ New Variable"** and add these:

| Variable | Value | Description |
|----------|-------|-------------|
| `AUTOMEM_API_TOKEN` | Generate a random string* | Auth token for API calls |
| `ADMIN_API_TOKEN` | Generate another random string* | Admin-only operations |
| `FALKORDB_HOST` | `falkordb.railway.internal` | Internal FalkorDB hostname |
| `FALKORDB_PORT` | `6379` | FalkorDB port |
| `OPENAI_API_KEY` | Your OpenAI API key (optional) | Enables real embeddings |

**Generate random strings:* Use `openssl rand -base64 32` in terminal or any password generator.

**Optional:** Add `QDRANT_URL` and `QDRANT_API_KEY` if using Qdrant Cloud for vector search.

4. Click **"Deploy"** to restart with new variables

---

#### Step 3: Get Your AutoMem URL (1 minute)

1. Click on your **automem** service (the API, not falkordb)
2. Go to **"Settings"** tab
3. Scroll to **"Networking"** → **"Public Networking"**
4. Click **"Generate Domain"**
5. **Copy the URL** - looks like: `automem-production-abc123.up.railway.app`

**✅ Save this URL!** You'll need it when configuring MCP clients below.

---

#### Step 4: Verify Deployment (30 seconds)

Test that everything works:

```bash
# Replace with YOUR Railway URL
curl https://automem-production-abc123.up.railway.app/health
```

**Expected response:**
```json
{"status": "healthy", "falkordb": "connected"}
```

**Got an error?**
- `503 Service Unavailable` = FalkorDB can't connect. Check:
  - `FALKORDB_HOST` is set to `falkordb.railway.internal`
  - FalkorDB service is running (green dot in Railway dashboard)
  - Volume is mounted at `/data`
- `401 Unauthorized` = You're trying a protected endpoint. `/health` should work without auth.

</details>

---

#### What You Just Built

```
┌─────────────────────────────────────┐
│  Railway Cloud (Your Free Tier)    │
│                                     │
│  ┌────────────────┐  ┌───────────┐ │
│  │  AutoMem API   │  │ FalkorDB  │ │
│  │  (Flask)       │──│ (Graph DB)│ │
│  │  Port: 443     │  │ +Volume   │ │
│  └────────────────┘  └───────────┘ │
│         ▲                           │
│         │ HTTPS                     │
│         │ (your-url.railway.app)    │
└─────────┼───────────────────────────┘
          │
          ▼
   Your AI Tools
   (any device, anywhere)
```

**Next step:** Use your Railway URL (e.g., `https://automem-production-abc123.up.railway.app`) as your `AUTOMEM_ENDPOINT` when configuring MCP clients below.

👉 **[Advanced Railway Configuration](RAILWAY_TEMPLATE_GUIDE.md)** - Custom domains, monitoring, template creation

---

## Platform-Specific MCP Client Setup

Now that your AutoMem service is running (locally or on Railway), configure your AI platforms to connect to it.

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
    "memory": {
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
    "memory": {
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

### 4. Configure Custom Instructions (Optional but Recommended)

Enable automatic memory usage by adding custom instructions to Claude Desktop.

**How to add Custom Instructions:**

1. Open Claude Desktop
2. Click the **Settings** icon (gear) in the bottom-left corner
3. Select **Custom Instructions** from the menu
4. Add the following to your instructions:

```markdown
<important>Using the Memory MCP is vital to our operations. When you start conversations, use the Memory tool to give yourself additional context. Wherever appropriate, create or update memories based on important milestones in the conversation.</important>
```

![Claude Desktop with Custom Instructions](screenshots/claude-desktop-custom-instructions-3.jpg)
*Add memory instructions to Custom Instructions*

5. Click **Save**
6. Restart Claude Desktop

**What this does:**
- Claude automatically recalls relevant memories at conversation start
- Stores important decisions, patterns, and context throughout conversations
- Greatly improves response quality by providing continuity across sessions

![Claude Desktop Using Memory](screenshots/claude-desktop-with-instructions.jpg)
*Claude automatically using memory tools with custom instructions*

**Example behavior:**
```
User: "Let's add authentication to the API"

Claude: [Automatically recalls memories]
📚 From memory:
- You prefer JWT tokens for authentication (from Project X)
- Use bcrypt for password hashing (security pattern)
- Express.js middleware pattern preferred

[Claude responds with context-aware implementation]
```

**Note:** Custom instructions are evolving rapidly in Claude Desktop. Check back for updates as we optimize the prompt based on new capabilities.

---

## Cursor IDE

### 1. One-Click Install (Fastest)

Click to install AutoMem MCP server in Cursor:

[![Install MCP Server](https://cursor.com/deeplink/mcp-install-light.svg)](cursor://anysphere.cursor-deeplink/mcp/install?name=memory&config=eyJlbnYiOnsiQVVUT01FTV9FTkRQT0lOVCI6Imh0dHA6Ly8xMjcuMC4wLjE6ODAwMSIsIkFVVE9NRU1fQVBJX0tFWSI6InlvdXItYXBpLWtleS1pZi1yZXF1aXJlZCJ9LCJjb21tYW5kIjoibnB4IEB2ZXJ5Z29vZHBsdWdpbnMvbWNwLWF1dG9tZW0ifQ%3D%3D)

**What this does:**
- Automatically adds AutoMem MCP server to Cursor's configuration
- No manual JSON editing required!

**After installation:**
- Update `AUTOMEM_ENDPOINT` with your AutoMem instance URL in `~/.cursor/mcp.json`
- Optionally set `AUTOMEM_API_KEY` if using authentication
- Restart Cursor to load the server

### 2. Add Memory Rule (Recommended)

Install the `automem.mdc` rule file to teach Cursor how to use memory:

```bash
npx @verygoodplugins/mcp-automem cursor
```

This will:
- Auto-detect your project name and description
- Create `.cursor/rules/automem.mdc` with memory-first instructions
- Check for MCP server configuration and provide setup guidance if missing

**Options:**
```bash
# Specify project details manually
npx @verygoodplugins/mcp-automem cursor --name my-project --desc "My awesome project"

# Preview changes without modifying files
npx @verygoodplugins/mcp-automem cursor --dry-run

# Custom target directory
npx @verygoodplugins/mcp-automem cursor --dir .cursor/rules
```

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

> ⚠️ **EXPERIMENTAL:** Claude Code hooks-based installation is actively evolving as we optimize based on real-world usage and new Claude Code capabilities. The default setup is intentionally minimal (git commits + builds only). Additional capture hooks are optional and should be enabled carefully. Expect frequent updates and improvements.

### 1. Install Automation Hooks

Run the Claude Code setup:

```bash
npx @verygoodplugins/mcp-automem claude-code
```

This command:
- Installs lean, high-signal hooks (git commit, build, session end)
- Merges tool permissions and hook definitions into `~/.claude/settings.json`
- Adds queue cleanup and deduplication to session-stop processing
- Sets up smart filtering (skips lock files, build artifacts, trivial changes)

**What gets captured by default:**
- Git commits with significant code changes (3+ meaningful files)
- Build results (success/failure with context)
- Session summaries (1-2 per session, deduplicated)

**What doesn't get captured:**
- Lock files, node_modules, build output
- Trivial changes (whitespace, formatting)
- Duplicate memories (content-hash based dedup)

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
    "memory": {
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
    "memory": {
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
[mcp_servers.memory]
command = "npx"
args = ["@verygoodplugins/mcp-automem"]

[mcp_servers.memory.env]
AUTOMEM_ENDPOINT = "https://your-automem-instance.railway.app"
AUTOMEM_API_KEY = "your-api-key-if-required"
```

**For local development:**
```toml
[mcp_servers.memory]
command = "npx"
args = ["@verygoodplugins/mcp-automem"]

[mcp_servers.memory.env]
AUTOMEM_ENDPOINT = "http://127.0.0.1:8001"
```

**Using local build (for development):**
```toml
[mcp_servers.memory]
command = "/opt/homebrew/bin/node"  # or "/usr/bin/node" on Linux
args = ["/path/to/mcp-automem/dist/index.js"]

[mcp_servers.memory.env]
AUTOMEM_ENDPOINT = "https://your-automem-instance.railway.app"
AUTOMEM_API_KEY = "your-api-key"

### 3.5. Add Memory Rules (Optional but recommended)

Install memory-first rules into your project so Codex proactively recalls and stores context:

```bash
npx @verygoodplugins/mcp-automem codex
```

This creates or updates `AGENTS.md` with an AutoMem section tailored to your project.

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
claude mcp add memory "npx @verygoodplugins/mcp-automem"
```

### Option 2: Global Installation

Install once, use anywhere:

```bash
# Install globally
npm install -g @verygoodplugins/mcp-automem

# For Claude Code
claude mcp add memory "mcp-automem"
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

#### Claude Code: Hooks not triggering
- Check `~/.claude/settings.json` has merged properly
- Verify hook scripts have execute permissions
- Test with `--dry-run` flag first

#### Warp: MCP server not loading
- Check `~/.warp/mcp.json` exists and has valid JSON syntax
- Verify AutoMem endpoint is reachable: `curl $AUTOMEM_ENDPOINT/health`
- Check Warp logs: `tail -f ~/.warp/logs/warp.log` (macOS/Linux)
- Restart Warp completely after config changes

#### Codex: MCP server not loading
- Verify config file exists at `~/.codex/config.toml`
- Check TOML syntax is valid (no missing brackets or quotes)
- Ensure command path is correct (use `which npx` or `which node`)
- Check AutoMem endpoint is accessible: `curl $AUTOMEM_ENDPOINT/health`
- Restart Codex CLI or reload IDE extension
- Ensure you have ChatGPT Plus/Pro/Team/Enterprise subscription

#### Codex: Memory tools not available
- Verify `[mcp_servers.memory]` section exists in config.toml
- Test explicitly: "Check AutoMem database health"
- Check Codex logs for MCP connection errors
- Ensure environment variables are set correctly in `[mcp_servers.memory.env]` section

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

- **Documentation**: This guide and [AutoMem Service Docs](https://github.com/verygoodplugins/automem/blob/main/INSTALLATION.md)
- **Issues**: [GitHub Issues](https://github.com/verygoodplugins/mcp-automem/issues)
- **AutoMem Service**: [AutoMem Repository](https://github.com/verygoodplugins/automem)

---

## Credits

Built by [Jack Arturo](https://x.com/verygoodplugins) 🧡

- Powered by [AutoMem](https://github.com/verygoodplugins/automem)
- Built with [Model Context Protocol SDK](https://github.com/anthropics/model-context-protocol)
- Part of the [Very Good Plugins](https://verygoodplugins.com) ecosystem
