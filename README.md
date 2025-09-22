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
        "AUTOMEM_ENDPOINT": "https://automem.up.railway.app"
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
        "AUTOMEM_ENDPOINT": "https://automem.up.railway.app"
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

Create a `.env` file for local development:

```env
# Required: AutoMem service endpoint
AUTOMEM_ENDPOINT=https://automem.up.railway.app

# Optional: API key (if your service requires authentication)
AUTOMEM_API_KEY=your_api_key_here

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
Retrieve memories using text or semantic search.

**Parameters:**
- `query` (optional): Text query to search for in memory content
- `embedding` (optional): Embedding vector for semantic similarity search
- `limit` (optional): Maximum number of memories to return (default: 5, max: 50)

**Example:**
```
Recall memories about "MCP server development"
```

#### `associate_memories`
Create relationships between memories.

**Parameters:**
- `memory1_id` (required): ID of the first memory
- `memory2_id` (required): ID of the second memory
- `type` (required): Relationship type - `RELATES_TO`, `LEADS_TO`, or `OCCURRED_BEFORE`
- `strength` (required): Association strength between 0 and 1

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
