#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { config } from 'dotenv';
import { runConfig, runSetup } from './cli/setup.js';
import { runClaudeCodeSetup } from './cli/claude-code.js';
import { runCursorSetup } from './cli/cursor.js';
import { runCodexSetup } from './cli/codex.js';
import { runMigrateCommand } from './cli/migrate.js';
import { runUninstallCommand } from './cli/uninstall.js';
import { runQueueCommand } from './cli/queue.js';
import { AutoMemClient } from './automem-client.js';
config();
const command = (process.argv[2] || '').toLowerCase();
if (command === 'help' || command === '--help' || command === '-h') {
    console.log(`
AutoMem MCP Server - AI Memory Storage & Recall

USAGE:
  npx @verygoodplugins/mcp-automem <command> [options]

COMMANDS:
  setup              Interactive setup for .env configuration
  config             Show configuration snippets
  claude-code        Set up AutoMem for Claude Code
  cursor             Set up AutoMem for Cursor
  migrate            Migrate existing projects to AutoMem
  uninstall          Remove AutoMem configuration
  queue              Manage memory queue
  recall             Recall memories via CLI
  help               Show this help message

        CURSOR SETUP:
          npx @verygoodplugins/mcp-automem cursor [options]

          Options:
            --name <name>           Project name (auto-detected if not provided)
            --dir <path>            Target directory for .cursor/rules (default: .cursor/rules)
            --dry-run              Show what would be changed without modifying files
            --quiet                Suppress output

          This command installs the automem.mdc rule file and checks for MCP server configuration.
          For global behavior across all projects, add memory rules to Cursor Settings > Rules for AI.

CLAUDE CODE SETUP:
  npx @verygoodplugins/mcp-automem claude-code [options]
  
  Options:
    --dir <path>           Target directory (default: ~/.claude)
    --profile <lean|extras> Use a predefined profile
    --dry-run             Show what would be changed
    --yes, -y             Skip confirmation prompts

MIGRATION:
  npx @verygoodplugins/mcp-automem migrate --from <source> --to <target>
  
  Options:
    --from <manual|none>   Source configuration
    --to <cursor|claude-code> Target platform
    --dir <path>          Project directory
    --dry-run             Preview migration
    --yes, -y             Skip confirmation

UNINSTALL:
  npx @verygoodplugins/mcp-automem uninstall <cursor|claude-code> [options]
  
  Options:
    --dir <path>          Project directory (for cursor)
    --clean-all          Also remove MCP server config (Cursor/Claude Desktop)
    --dry-run           Show what would be removed
    --yes, -y           Skip confirmation

RECALL:
  npx @verygoodplugins/mcp-automem recall [options]
  
  Options:
    --query <text>        Search query
    --tags <tag1,tag2>    Filter by tags (comma-separated)
    --limit <number>      Maximum results (default: 5)

        EXAMPLES:
          # Set up Cursor in current project (installs automem.mdc rule)
          npx @verygoodplugins/mcp-automem cursor

          # Set up with custom project name
          npx @verygoodplugins/mcp-automem cursor --name my-project

          # Set up Claude Code with lean profile
          npx @verygoodplugins/mcp-automem claude-code --profile lean

          # Migrate manual memory usage to Cursor
          npx @verygoodplugins/mcp-automem migrate --from manual --to cursor

          # Uninstall Cursor AutoMem
          npx @verygoodplugins/mcp-automem uninstall cursor

          # Recall memories matching a query
          npx @verygoodplugins/mcp-automem recall --query "authentication decisions" --limit 5

CODEX SETUP:
  npx @verygoodplugins/mcp-automem codex [options]
  
  Options:
    --name <name>         Project name (auto-detected if not provided)
    --rules <path>        Target rules file (default: ./AGENTS.md)
    --dry-run             Show what would be changed
    --quiet               Suppress output

For more information, visit:
https://github.com/verygoodplugins/mcp-automem
`);
    process.exit(0);
}
if (command === 'setup') {
    await runSetup(process.argv.slice(3));
    process.exit(0);
}
if (command === 'config') {
    await runConfig(process.argv.slice(3));
    process.exit(0);
}
if (command === 'claude-code') {
    await runClaudeCodeSetup(process.argv.slice(3));
    process.exit(0);
}
if (command === 'cursor') {
    await runCursorSetup(process.argv.slice(3));
    process.exit(0);
}
if (command === 'codex') {
    await runCodexSetup(process.argv.slice(3));
    process.exit(0);
}
if (command === 'migrate') {
    await runMigrateCommand(process.argv.slice(3));
    process.exit(0);
}
if (command === 'uninstall') {
    await runUninstallCommand(process.argv.slice(3));
    process.exit(0);
}
if (command === 'queue') {
    await runQueueCommand(process.argv.slice(3));
    process.exit(0);
}
if (command === 'recall') {
    const AUTOMEM_ENDPOINT = process.env.AUTOMEM_ENDPOINT || 'http://127.0.0.1:8001';
    const AUTOMEM_API_KEY = process.env.AUTOMEM_API_KEY;
    if (!AUTOMEM_ENDPOINT) {
        console.error('❌ AUTOMEM_ENDPOINT not set');
        process.exit(1);
    }
    const client = new AutoMemClient({ endpoint: AUTOMEM_ENDPOINT, apiKey: AUTOMEM_API_KEY });
    // Parse CLI args
    const args = process.argv.slice(3);
    let query = '';
    let tags = [];
    let limit = 5;
    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--query' && args[i + 1]) {
            query = args[++i];
        }
        else if (args[i] === '--tags' && args[i + 1]) {
            tags = args[++i].split(',');
        }
        else if (args[i] === '--limit' && args[i + 1]) {
            limit = parseInt(args[++i], 10);
        }
    }
    try {
        const results = await client.recallMemory({ query, tags, limit });
        console.log(JSON.stringify(results, null, 2));
        process.exit(0);
    }
    catch (error) {
        console.error('❌ Recall failed:', error);
        process.exit(1);
    }
}
const AUTOMEM_ENDPOINT = process.env.AUTOMEM_ENDPOINT || 'http://127.0.0.1:8001';
const AUTOMEM_API_KEY = process.env.AUTOMEM_API_KEY;
if (!process.env.AUTOMEM_ENDPOINT) {
    console.warn('⚠️  AUTOMEM_ENDPOINT not set. Run `npx @verygoodplugins/mcp-automem setup` or export the environment variable before connecting.');
}
const clientConfig = {
    endpoint: AUTOMEM_ENDPOINT,
    apiKey: AUTOMEM_API_KEY,
};
const client = new AutoMemClient(clientConfig);
const server = new Server({ name: 'mcp-automem', version: '0.6.0' }, { capabilities: { tools: {} } });
const tools = [
    {
        name: 'store_memory',
        description: 'Store a memory with optional tags, importance score, metadata, timestamps, and embedding vector',
        inputSchema: {
            type: 'object',
            properties: {
                content: {
                    type: 'string',
                    description: 'The memory content to store',
                },
                tags: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'Optional tags to categorize the memory',
                },
                importance: {
                    type: 'number',
                    minimum: 0,
                    maximum: 1,
                    description: 'Optional importance score between 0 and 1',
                },
                embedding: {
                    type: 'array',
                    items: { type: 'number' },
                    description: 'Optional embedding vector for semantic search',
                },
                metadata: {
                    type: 'object',
                    description: 'Optional metadata payload (entities, source, etc.)',
                },
                timestamp: {
                    type: 'string',
                    description: 'Optional ISO timestamp indicating when this memory was created',
                },
            },
            required: ['content'],
        },
    },
    {
        name: 'recall_memory',
        description: 'Recall memories with hybrid semantic/keyword search and optional time/tag filters',
        inputSchema: {
            type: 'object',
            properties: {
                query: {
                    type: 'string',
                    description: 'Text query to search for in memory content',
                },
                embedding: {
                    type: 'array',
                    items: { type: 'number' },
                    description: 'Embedding vector for semantic similarity search',
                },
                limit: {
                    type: 'integer',
                    minimum: 1,
                    maximum: 50,
                    default: 5,
                    description: 'Maximum number of memories to return',
                },
                time_query: {
                    type: 'string',
                    description: 'Natural language time window (e.g. "today", "last week", "last 7 days")',
                },
                start: {
                    type: 'string',
                    description: 'Explicit ISO timestamp lower bound',
                },
                end: {
                    type: 'string',
                    description: 'Explicit ISO timestamp upper bound',
                },
                tags: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'Return memories containing any of these tags',
                },
                tag_mode: {
                    type: 'string',
                    enum: ['any', 'all'],
                    description: 'How to combine multiple tags: any (default) or all',
                },
                tag_match: {
                    type: 'string',
                    enum: ['exact', 'prefix'],
                    description: 'How to match tags: exact (default) or prefix',
                },
            },
        },
    },
    {
        name: 'associate_memories',
        description: 'Create an association between two memories with a relationship type and strength',
        inputSchema: {
            type: 'object',
            properties: {
                memory1_id: {
                    type: 'string',
                    description: 'ID of the first memory',
                },
                memory2_id: {
                    type: 'string',
                    description: 'ID of the second memory',
                },
                type: {
                    type: 'string',
                    enum: [
                        'RELATES_TO',
                        'LEADS_TO',
                        'OCCURRED_BEFORE',
                        'PREFERS_OVER',
                        'EXEMPLIFIES',
                        'CONTRADICTS',
                        'REINFORCES',
                        'INVALIDATED_BY',
                        'EVOLVED_INTO',
                        'DERIVED_FROM',
                        'PART_OF',
                    ],
                    description: 'Type of relationship between the memories',
                },
                strength: {
                    type: 'number',
                    minimum: 0,
                    maximum: 1,
                    description: 'Strength of the association between 0 and 1',
                },
            },
            required: ['memory1_id', 'memory2_id', 'type', 'strength'],
        },
    },
    {
        name: 'update_memory',
        description: 'Update an existing memory (content, tags, metadata, timestamps, importance)',
        inputSchema: {
            type: 'object',
            properties: {
                memory_id: {
                    type: 'string',
                    description: 'ID of the memory to update',
                },
                content: { type: 'string' },
                tags: {
                    type: 'array',
                    items: { type: 'string' },
                },
                importance: { type: 'number', minimum: 0, maximum: 1 },
                metadata: { type: 'object' },
                timestamp: { type: 'string' },
                updated_at: { type: 'string' },
                last_accessed: { type: 'string' },
                type: { type: 'string' },
                confidence: { type: 'number', minimum: 0, maximum: 1 },
            },
            required: ['memory_id'],
        },
    },
    {
        name: 'delete_memory',
        description: 'Delete a memory and its embedding',
        inputSchema: {
            type: 'object',
            properties: {
                memory_id: {
                    type: 'string',
                    description: 'ID of the memory to delete',
                },
            },
            required: ['memory_id'],
        },
    },
    {
        name: 'check_database_health',
        description: 'Check the health status of the AutoMem service and its connected databases',
        inputSchema: {
            type: 'object',
            properties: {},
        },
    },
];
server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools,
}));
server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    try {
        switch (name) {
            case 'store_memory': {
                const storeArgs = args;
                const result = await client.storeMemory(storeArgs);
                return {
                    content: [
                        {
                            type: 'text',
                            text: `Memory stored successfully!\n\nMemory ID: ${result.memory_id}\nMessage: ${result.message}`,
                        },
                    ],
                };
            }
            case 'recall_memory': {
                const recallArgs = args;
                let merged = [];
                // If tags are provided, fetch both endpoints in parallel for better performance
                if (Array.isArray(recallArgs.tags) && recallArgs.tags.length > 0) {
                    try {
                        const [primary, tagOnly] = await Promise.all([
                            client.recallMemory(recallArgs),
                            client.searchByTag({ tags: recallArgs.tags, limit: recallArgs.limit || 5 }).catch(() => ({ results: [] })),
                        ]);
                        merged = primary.results || [];
                        // Merge tag-only results
                        const byId = new Map();
                        for (const r of merged)
                            byId.set(r.memory.memory_id, r);
                        for (const t of tagOnly.results || []) {
                            const id = t.memory.memory_id;
                            if (!byId.has(id)) {
                                byId.set(id, t);
                            }
                        }
                        merged = Array.from(byId.values());
                        // Sort by final_score desc if present, otherwise by importance desc
                        merged.sort((a, b) => {
                            const as = typeof a.final_score === 'number' ? a.final_score : (a.memory.importance ?? 0);
                            const bs = typeof b.final_score === 'number' ? b.final_score : (b.memory.importance ?? 0);
                            return bs - as;
                        });
                        // Enforce limit after merge
                        if (recallArgs.limit && merged.length > recallArgs.limit) {
                            merged = merged.slice(0, recallArgs.limit);
                        }
                    }
                    catch (e) {
                        // Non-fatal: if recall fails, return empty results
                    }
                }
                else {
                    // No tags provided, just do primary recall
                    const primary = await client.recallMemory(recallArgs);
                    merged = primary.results || [];
                }
                if (!merged || merged.length === 0) {
                    return {
                        content: [
                            {
                                type: 'text',
                                text: 'No memories found matching your query.',
                            },
                        ],
                    };
                }
                const memoriesText = merged
                    .map((item, index) => {
                    const memory = item.memory;
                    const tags = memory.tags?.length ? ` [${memory.tags.join(', ')}]` : '';
                    const importance = typeof memory.importance === 'number' ? ` (importance: ${memory.importance})` : '';
                    const score = typeof item.final_score === 'number' ? ` score=${item.final_score.toFixed(3)}` : '';
                    return `${index + 1}. ${memory.content}${tags}${importance}${score}\n   ID: ${memory.memory_id}\n   Created: ${memory.created_at}`;
                })
                    .join('\n\n');
                return {
                    content: [
                        {
                            type: 'text',
                            text: `Found ${merged.length} memories:\n\n${memoriesText}`,
                        },
                    ],
                };
            }
            case 'associate_memories': {
                const associateArgs = args;
                const result = await client.associateMemories(associateArgs);
                return {
                    content: [
                        {
                            type: 'text',
                            text: `Association created successfully!\n\nMessage: ${result.message}`,
                        },
                    ],
                };
            }
            case 'update_memory': {
                const updateArgs = args;
                const result = await client.updateMemory(updateArgs);
                return {
                    content: [
                        {
                            type: 'text',
                            text: `Memory ${result.memory_id} updated successfully!`,
                        },
                    ],
                };
            }
            case 'delete_memory': {
                const deleteArgs = args;
                const result = await client.deleteMemory(deleteArgs);
                return {
                    content: [
                        {
                            type: 'text',
                            text: `Memory ${result.memory_id} deleted successfully!`,
                        },
                    ],
                };
            }
            case 'check_database_health': {
                const health = await client.checkHealth();
                const statusEmoji = health.status === 'healthy' ? '✅' : '❌';
                let statsText = '';
                if (health.statistics.falkordb) {
                    statsText += `\nFalkorDB: ${health.statistics.falkordb}`;
                }
                if (health.statistics.qdrant) {
                    statsText += `\nQdrant: ${health.statistics.qdrant}`;
                }
                if (health.statistics.graph) {
                    statsText += `\nGraph: ${health.statistics.graph}`;
                }
                if (health.statistics.timestamp) {
                    statsText += `\nTimestamp: ${health.statistics.timestamp}`;
                }
                const errorText = health.error ? `\nError: ${health.error}` : '';
                return {
                    content: [
                        {
                            type: 'text',
                            text: `${statusEmoji} AutoMem Health Status\n\nStatus: ${health.status}\nBackend: ${health.backend}${statsText}${errorText}`,
                        },
                    ],
                };
            }
            default:
                throw new Error(`Unknown tool: ${name}`);
        }
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
        return {
            content: [
                {
                    type: 'text',
                    text: `Error: ${errorMessage}`,
                },
            ],
            isError: true,
        };
    }
});
async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error('AutoMem MCP server running');
}
main().catch((error) => {
    console.error('Server error:', error);
    process.exit(1);
});
//# sourceMappingURL=index.js.map