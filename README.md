# AutoMem MCP: Give Your AI Perfect Memory

<p align="center">
  <img src="assets/icon.svg" alt="AutoMem" width="80" height="80" />
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@verygoodplugins/mcp-automem"><img src="https://img.shields.io/npm/v/@verygoodplugins/mcp-automem" alt="Version" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/npm/l/@verygoodplugins/mcp-automem" alt="License" /></a>
  <a href="https://automem.ai/discord"><img src="https://img.shields.io/badge/Discord-Join%20Community-5865F2?logo=discord&logoColor=white" alt="Discord" /></a>
  <a href="https://x.com/automem_ai"><img src="https://img.shields.io/badge/X-@automem__ai-000000?logo=x&logoColor=white" alt="X (Twitter)" /></a>
</p>

**One command. Infinite memory. Perfect recall across all your AI tools.**

```bash
npx @verygoodplugins/mcp-automem setup
```

Your AI assistant now remembers everything. Forever. Across every conversation.

<div align="center">

https://github.com/user-attachments/assets/fd79112b-5158-4320-a054-8c18ab1ea314

</div>

<p align="center"><sub><b>The guided installer</b> — <code>npx @verygoodplugins/mcp-automem setup</code> walks you through local, hosted, or existing-endpoint setup.</sub></p>

Works with **Claude Desktop**, **Cursor IDE**, **Claude Code**, **GitHub Copilot (coding agent)**, **ChatGPT**, **ElevenLabs**, **OpenAI Codex**, **Google Antigravity** - any MCP-compatible AI platform.

## The Problem We Solve

Every AI conversation starts from zero. Claude forgets your coding style. Cursor can't learn your patterns. Your assistant doesn't remember yesterday's decisions.

**Until now.**

AutoMem MCP connects your AI to persistent memory powered by **[AutoMem](https://github.com/verygoodplugins/automem)** - a graph-vector memory service.

## What You Get

### 🧠 Persistent Memory Across Sessions

- AI remembers decisions, patterns, and context **forever**
- Works across **all MCP platforms** - Claude Desktop, Cursor, Claude Code, OpenAI Codex, Google Antigravity
- **Cross-device sync** - same memory on Mac, Windows, Linux

### 🏆 Graph-Vector Architecture

- **11 public authorable relationship types** between memories (recall results may also include read-only system/internal relations that are not valid `associate_memories` inputs)
- **Research-validated** approach (HippoRAG 2: 7% better associative memory)
- **Sub-second retrieval** even with millions of memories

### 🚀 Works Everywhere You Code

| Platform           | Support | Setup Time |
| ------------------ | ------- | ---------- |
| **Claude Desktop** | ✅ Full | 30 seconds |
| **Cursor IDE**     | ✅ Full | 30 seconds |
| **Claude Code**    | ✅ Full | 30 seconds |
| **GitHub Copilot** | ✅ Full | 2 minutes  |
| **OpenAI Codex**   | ✅ Full | 30 seconds |
| **Google Antigravity** | ✅ Full | 30 seconds |
| **Any MCP client** | ✅ Full | 30 seconds |

## See It In Action

### Claude Desktop with Personal Preferences

![Claude Desktop Using Memory](screenshots/claude-desktop-with-instructions.jpg)
_Claude automatically recalls memories using the Personal Preferences template_

### Cursor IDE with Memory Rules

![Cursor with Memory](screenshots/cursor-2.jpg)
_Cursor uses automem.mdc rule to automatically recall and store memories_

### Claude Code with Session Memory

![Claude Code Memory Capture](screenshots/claude-code-1.jpg)
_Session-start recall plus LLM-judged storage: Claude decides what's durable and stores it via the memory tools_

More platform walkthroughs (Codex, Hermes, Antigravity, remote MCP) live in the **[Installation Guide](INSTALLATION.md)**.

## Quick Start

### 1. Set Up AutoMem Service

You need a running AutoMem service (the memory backend). Choose one:

**Option A: Local Development** (fastest, free)

```bash
git clone https://github.com/verygoodplugins/automem.git
cd automem
make dev
```

Service runs at `http://localhost:8001` - perfect for single-machine use.

**Option B: Railway Cloud** (recommended for production)

[![Deploy on Railway](https://railway.com/button.svg)](https://github.com/verygoodplugins/automem/blob/main/INSTALLATION.md#railway-deployment)

One-click deploy with $5 free credits. Typical cost: ~$0.50-1/month after trial.

👉 **[AutoMem Service Installation Guide](https://github.com/verygoodplugins/automem/blob/main/INSTALLATION.md)** - Complete setup instructions for local, Railway, Docker, and production deployments.

---

### 2. Install MCP Client

#### Claude Desktop - One-Click Install

Download and double-click to install AutoMem in Claude Desktop:

**[⬇️ Download AutoMem for Claude Desktop (.mcpb)](https://github.com/verygoodplugins/mcp-automem/releases/latest/download/mcp-automem.mcpb)**

After installing:
1. Claude Desktop will prompt you for your **AutoMem Endpoint** (`http://127.0.0.1:8001` for local)
2. Optionally enter your **API Key** (required for Railway, skip for local)
3. Click Enable

Then add the paste-ready Personal Preferences starter from [`templates/CLAUDE_DESKTOP_INSTRUCTIONS.md`](templates/CLAUDE_DESKTOP_INSTRUCTIONS.md). That's it: Claude now has persistent memory and knows when to use it.

#### Other Platforms

Connect your AI tools to the AutoMem service you just started.

```bash
# Guided setup - creates .env and prints config for your AI platform
npx @verygoodplugins/mcp-automem setup
```

**When prompted:**

- **AutoMem Endpoint:** `http://localhost:8001` (or your Railway URL if deployed)
- **API Key:** Leave blank for local development (or paste your token for Railway)

The wizard will:

- ✅ Save your endpoint and API key to `.env`
- ✅ Generate config snippets for Claude Desktop/Cursor/Code
- ✅ Validate connection to your AutoMem service

### 3. Platform-Specific Setup

**For Claude Code (plugin — recommended):**

```text
# In Claude Code:
/plugin marketplace add verygoodplugins/mcp-automem
/plugin install automem@verygoodplugins-mcp-automem
```

Claude Code prompts for your AutoMem URL and API key at enable time, bundles the MCP server and silent recall/store-tracking hooks, and auto-updates. Prefer hooks and permissions written directly into `~/.claude/` instead? Run `npx @verygoodplugins/mcp-automem claude-code`.

On Windows, the hook payload assumes a POSIX shell environment such as Git Bash, MSYS2, or WSL — only `bash` is required (the hooks are pure bash+sed).

**For Cursor IDE:**

[![Install MCP Server](https://cursor.com/deeplink/mcp-install-light.svg)](cursor://anysphere.cursor-deeplink/mcp/install?name=memory&config=eyJlbnYiOnsiQVVUT01FTV9BUElfVVJMIjoiaHR0cDovLzEyNy4wLjAuMTo4MDAxIiwiQVVUT01FTV9BUElfS0VZIjoieW91ci1hcGkta2V5LWlmLXJlcXVpcmVkIn0sImNvbW1hbmQiOiJucHggLXkgQHZlcnlnb29kcGx1Z2lucy9tY3AtYXV0b21lbSJ9)

```bash
# Or use CLI to install automem.mdc rule file
npx @verygoodplugins/mcp-automem cursor
```

**Other platforms** — Claude Desktop (one-click `.mcpb` above, plus the [Personal Preferences template](templates/CLAUDE_DESKTOP_INSTRUCTIONS.md)), [OpenAI Codex](INSTALLATION.md#openai-codex), [Hermes Agent](INSTALLATION.md#hermes-agent), [Google Antigravity](INSTALLATION.md#google-antigravity), and [GitHub Copilot](INSTALLATION.md#github-copilot-coding-agent-githubcom):

👉 **[Full Installation Guide](INSTALLATION.md)** for every platform's setup and verification steps

---

## Remote MCP via HTTP

An optional sidecar service (deployable to Railway or any Docker host) connects AutoMem to platforms that support remote MCP over **Streamable HTTP** or SSE — ChatGPT (Developer Mode connectors), Claude.ai web and Claude Mobile, and ElevenLabs Agents.

👉 **[Remote MCP setup](INSTALLATION.md#remote-mcp-via-http-sidecar)** for deployment, connect URLs, and per-platform screenshots.

## Architecture

```
┌─────────────────────────────────────────────┐
│         Your AI Platforms                   │
│  Claude Desktop │ Cursor │ Claude Code      │
└──────────────┬──────────────────────────────┘
               │ MCP Protocol
               ▼
┌──────────────────────────────────────────────┐
│   @verygoodplugins/mcp-automem (this repo)  │
│   • Translates MCP calls → AutoMem API      │
│   • Platform integrations & rules           │
│   • Handles authentication                   │
└──────────────┬───────────────────────────────┘
               │ HTTP API
               ▼
┌──────────────────────────────────────────────┐
│        AutoMem Service (separate repo)       │
│        github.com/verygoodplugins/automem    │
│   ┌────────────┐      ┌────────────┐        │
│   │  FalkorDB  │      │   Qdrant   │        │
│   │  (Graph)   │      │ (Vectors)  │        │
│   └────────────┘      └────────────┘        │
└──────────────────────────────────────────────┘
```

**This repo (mcp-automem):**

- MCP client that connects AI platforms to AutoMem
- Platform-specific integrations (Cursor rules, Claude Code hooks, etc.)
- Setup wizards and configuration tools

**[AutoMem service](https://github.com/verygoodplugins/automem):**

- Backend memory service with graph + vector storage
- Deployment guides (local, Railway, Docker, production)
- API server with FalkorDB + Qdrant

## Features

### Core Memory Operations

- **`store_memory`** — Save memories with content, tags, importance, metadata. Two modes:
  - **Single (default)**: top-level `content` plus optional fields, including `embedding`, `t_valid`, `t_invalid`, custom `id`.
  - **Batch**: `memories: [...]` (≤500 items) for bulk ingestion. Per-item `id`/`embedding`/`t_valid`/`t_invalid` are not supported in batch mode.
- **`recall_memory`** — Three modes selected by which params you pass:
  - **ID fetch**: `memory_id` → fetches one memory by ID; updates `last_accessed`.
  - **Tag enumeration**: `tags` + `exhaustive: true` → paginated exact-match listing for cleanup/audit workflows where ranked recall undercounts. Pair with `limit` (≤200) and `offset`; returns `has_more`.
  - **Ranked retrieval (default)**: hybrid search across vector, keyword, tags, recency, with optional graph expansion and `exclude_tags` to filter out unwanted scopes.
- **`associate_memories`** — Create relationships (11 public authorable types; recall results may also include read-only system relations)
- **`update_memory`** — Modify existing memories
- **`delete_memory`** — Two modes:
  - **Single (default)**: `memory_id` → removes one memory and its embedding.
  - **Bulk-by-tag**: `tags: [...]` → bulk-delete all memories matching ANY tag (exact, case-insensitive). No dry-run; verify with `recall_memory({ tags, exhaustive: true })` first.
- **`check_database_health`** — Monitor service status

### Advanced Recall (v0.8.0+)

**Multi-hop Reasoning** - Answer complex questions like "What is Amanda's sister's career?"

```javascript
mcp__memory__recall_memory({
  query: "What is Amanda's sister's career?",
  expand_entities: true, // Finds "Amanda's sister is Rachel" → memories about Rachel
});
```

**Context-Aware Coding** - Recall prioritizes language and style preferences

```javascript
mcp__memory__recall_memory({
  query: "error handling patterns",
  language: "typescript",
  context_types: ["Style", "Pattern"],
});
```

### Platform Integrations

#### Cursor IDE

- ✅ **Memory-first rule file** (`automem.mdc` in `.cursor/rules/`)
- ✅ **Automatic memory recall** at conversation start
- ✅ **Auto-detects project context** (package.json, git remote)
- ✅ **Global user rules option** for all projects
- ✅ **Simple setup** via CLI or one-click install

#### Claude Code

- ✅ **Native plugin** - MCP server, silent hooks, and skill in one `/plugin install`, with enable-time config prompts and auto-updates
- ✅ **LLM-judged storage** - session-start guidance nudges Claude to store, verify, and associate durable memories during normal work
- ✅ **Memory rules** in CLAUDE.md guide Claude's memory usage

#### Claude Desktop

- ✅ Direct MCP integration
- ✅ Paste-ready Personal Preferences starter template
- ✅ Full memory API access

## Why AutoMem MCP?

### vs. Building Your Own

- ✅ **2 years of R&D** already done
- ✅ **Research-validated** architecture (HippoRAG 2, MELODI, A-MEM)
- ✅ **Working integrations** across all MCP platforms
- ✅ **Active development** and community

### vs. Other Memory Solutions

- ✅ **True graph relationships** (not just vector similarity)
- ✅ **Universal MCP compatibility** (works with any MCP client)
- ✅ **7 memory types** (Decision/Pattern/Preference/Style/Habit/Insight/Context)
- ✅ **Self-hostable** ($5/month vs $150+ for alternatives)

### vs. Native AI Memory

- ✅ **Persistent across sessions** (not just context window)
- ✅ **Cross-platform** (same memory in Claude, Cursor, Code)
- ✅ **Structured relationships** (not just RAG)
- ✅ **Infinite scale** (no context window limits)

## Documentation

### MCP Client & Integrations (this repo)

- 📦 **[Installation Guide](INSTALLATION.md)** - MCP client setup for all platforms
- 🌐 **[Remote MCP via HTTP](INSTALLATION.md#remote-mcp-via-http-sidecar)** - Connect ChatGPT, Claude Web/Mobile, ElevenLabs
- 🎯 **[Cursor Setup](INSTALLATION.md#cursor-ide)** - IDE integration with rules
- 🤖 **[Claude Code Setup](templates/CLAUDE_CODE_INTEGRATION.md)** - Plugin install, hooks, and memory rules
- ⚠️ **[Deprecations](DEPRECATION.md)** - History of the plugin deprecation and its reversal
- 🚀 **[OpenAI Codex Setup](INSTALLATION.md#openai-codex)** - Codex CLI/IDE/Cloud integration
- 🪐 **[Google Antigravity Setup](INSTALLATION.md#google-antigravity)** - Raw MCP config via Antigravity's MCP Store
- 📖 **[MCP Tools Reference](INSTALLATION.md#mcp-tools)** - All memory operations
- 📝 **[Changelog](CHANGELOG.md)** - Release history

### AutoMem Service (separate repo)

- 🏗️ **[AutoMem Service](https://github.com/verygoodplugins/automem)** - Backend repository
- 🚀 **[Service Installation](https://github.com/verygoodplugins/automem/blob/main/INSTALLATION.md)** - Local, Railway, Docker deployment
- ⚙️ **[API Documentation](https://github.com/verygoodplugins/automem#api-reference)** - REST API reference
- 🧪 **[Evaluation Lab](https://github.com/verygoodplugins/automem-evals)** - Exploratory recall-quality benchmarks and ruleset A/B testing

## The Science Behind AutoMem

The AutoMem service implements cutting-edge 2025 research:

- **[HippoRAG 2](https://arxiv.org/abs/2502.14802)** (OSU, June 2025): Graph-vector approach achieves 7% better associative memory
- **A-MEM** (July 2025): Dynamic memory organization with Zettelkasten principles
- **MELODI** (DeepMind, 2025): 8x memory compression without quality loss
- **ReadAgent** (DeepMind, 2024): 20x context extension through gist memories

This MCP package provides the bridge between your AI and that research-validated memory system.

## Community & Support

- 💬 **[Discord](https://automem.ai/discord)** - Join the community, get help, share feedback
- 🐦 **[X Community](https://x.com/i/communities/2013114118912225326)** - Discussion and updates
- 📣 **[@automem_ai](https://x.com/automem_ai)** - Official announcements
- 📦 **[NPM Package](https://www.npmjs.com/package/@verygoodplugins/mcp-automem)** - This MCP client
- 🔬 **[AutoMem Service](https://github.com/verygoodplugins/automem)** - Backend repo with deployment guides
- 🐛 **[GitHub Issues](https://github.com/verygoodplugins/mcp-automem/issues)** - Bug reports and feature requests

## Contributing

We welcome contributions! Please:

1. Fork the repository
2. Create a feature branch
3. Make your changes with tests
4. Submit a pull request with a Conventional Commit title such as `fix:`, `feat:`, `docs:`, or `chore:`
5. Do not prefix the PR title with labels like `[codex]` or `[wip]` because the squash-merge commit is taken from the PR title

## License

MIT - Because great memory should be free.

---

**Ready to give your AI perfect memory?**

```bash
npx @verygoodplugins/mcp-automem setup
```

_Built with obsession. Validated by neuroscience. Powered by graph theory. Works with every MCP-enabled AI._

_Designed by Jack Arturo at [Very Good Plugins](https://verygoodplugins.com)_ 🧡

**Transform your AI from a tool into a teammate. Start now.**
