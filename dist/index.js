#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { config } from 'dotenv';
import { runConfig, runSetup } from './cli/setup.js';
import { runClaudeCodeSetup } from './cli/claude-code.js';
import { runQueueCommand } from './cli/queue.js';
import { AutoMemClient } from './automem-client.js';
config();
const command = (process.argv[2] || '').toLowerCase();
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
if (command === 'queue') {
    await runQueueCommand(process.argv.slice(3));
    process.exit(0);
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
const server = new Server({ name: 'mcp-automem', version: '0.1.0' }, { capabilities: { tools: {} } });
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
                    enum: ['RELATES_TO', 'LEADS_TO', 'OCCURRED_BEFORE'],
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
                const result = await client.recallMemory(recallArgs);
                if (!result.results || result.results.length === 0) {
                    return {
                        content: [
                            {
                                type: 'text',
                                text: 'No memories found matching your query.',
                            },
                        ],
                    };
                }
                const memoriesText = result.results
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
                            text: `Found ${result.results.length} memories:\n\n${memoriesText}`,
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