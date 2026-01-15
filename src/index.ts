#!/usr/bin/env node
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  GetPromptRequestSchema,
  ListToolsRequestSchema,
  ListPromptsRequestSchema,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { config } from "dotenv";
import { runConfig, runSetup } from "./cli/setup.js";
import { runClaudeCodeSetup } from "./cli/claude-code.js";
import { runCursorSetup } from "./cli/cursor.js";
import { runCodexSetup } from "./cli/codex.js";
import { runMigrateCommand } from "./cli/migrate.js";
import { runUninstallCommand } from "./cli/uninstall.js";
import { runQueueCommand } from "./cli/queue.js";
import { AutoMemClient } from "./automem-client.js";
import type {
  AutoMemConfig,
  StoreMemoryArgs,
  RecallMemoryArgs,
  AssociateMemoryArgs,
  UpdateMemoryArgs,
  DeleteMemoryArgs,
} from "./types.js";

config();

function isInteractiveTerminal(): boolean {
  return Boolean(process.stdout.isTTY && process.stderr.isTTY);
}

function installStdioErrorGuards() {
  const handler = (error: unknown) => {
    const err = error as { code?: string } | undefined;
    if (err?.code === "EPIPE" || err?.code === "ECONNRESET") {
      process.exit(0);
    }
  };

  process.stdout.on("error", handler);
  process.stderr.on("error", handler);
}

// Read version from package.json - single source of truth
function getPackageVersion(): string {
  const packageJsonPath = path.resolve(
    fileURLToPath(new URL("../package.json", import.meta.url))
  );
  try {
    const pkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
    return pkg.version || "0.0.0";
  } catch {
    return "0.0.0";
  }
}

const PACKAGE_VERSION = getPackageVersion();

const command = (process.argv[2] || "").toLowerCase();

if (command === "help" || command === "--help" || command === "-h") {
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

if (command === "setup") {
  await runSetup(process.argv.slice(3));
  process.exit(0);
}

if (command === "config") {
  await runConfig(process.argv.slice(3));
  process.exit(0);
}

if (command === "claude-code") {
  await runClaudeCodeSetup(process.argv.slice(3));
  process.exit(0);
}

if (command === "cursor") {
  await runCursorSetup(process.argv.slice(3));
  process.exit(0);
}

if (command === "codex") {
  await runCodexSetup(process.argv.slice(3));
  process.exit(0);
}

if (command === "migrate") {
  await runMigrateCommand(process.argv.slice(3));
  process.exit(0);
}

if (command === "uninstall") {
  await runUninstallCommand(process.argv.slice(3));
  process.exit(0);
}

if (command === "queue") {
  await runQueueCommand(process.argv.slice(3));
  process.exit(0);
}

if (command === "recall") {
  const AUTOMEM_ENDPOINT =
    process.env.AUTOMEM_ENDPOINT || "http://127.0.0.1:8001";
  const AUTOMEM_API_KEY = process.env.AUTOMEM_API_KEY;

  if (!AUTOMEM_ENDPOINT) {
    console.error("❌ AUTOMEM_ENDPOINT not set");
    process.exit(1);
  }

  const client = new AutoMemClient({
    endpoint: AUTOMEM_ENDPOINT,
    apiKey: AUTOMEM_API_KEY,
  });

  // Parse CLI args
  const args = process.argv.slice(3);
  let query = "";
  let tags: string[] = [];
  let limit = 5;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--query" && args[i + 1]) {
      query = args[++i];
    } else if (args[i] === "--tags" && args[i + 1]) {
      tags = args[++i].split(",");
    } else if (args[i] === "--limit" && args[i + 1]) {
      limit = parseInt(args[++i], 10);
    }
  }

  try {
    const results = await client.recallMemory({ query, tags, limit });
    console.log(JSON.stringify(results, null, 2));
    process.exit(0);
  } catch (error) {
    console.error("❌ Recall failed:", error);
    process.exit(1);
  }
}

const AUTOMEM_ENDPOINT =
  process.env.AUTOMEM_ENDPOINT || "http://127.0.0.1:8001";
const AUTOMEM_API_KEY = process.env.AUTOMEM_API_KEY;

if (!process.env.AUTOMEM_ENDPOINT) {
  if (isInteractiveTerminal()) {
    console.warn(
      "⚠️  AUTOMEM_ENDPOINT not set. Run `npx @verygoodplugins/mcp-automem setup` or export the environment variable before connecting."
    );
  }
}

const clientConfig: AutoMemConfig = {
  endpoint: AUTOMEM_ENDPOINT,
  apiKey: AUTOMEM_API_KEY,
};

const client = new AutoMemClient(clientConfig);

const server = new Server(
  { name: "mcp-automem", version: PACKAGE_VERSION },
  { capabilities: { tools: {}, prompts: {} } }
);

const tools: Tool[] = [
  {
    name: "store_memory",
    title: "Store Memory",
    description: `Store a memory with optional tags, importance score, and metadata. Use this to persist important information for future recall.

**Content size guidelines:**
- Target: 150-300 characters (one meaningful paragraph)
- Maximum: 500 characters (auto-summarized if exceeded)
- Hard limit: 2000 characters (rejected)
- Format: "Brief title. Context and details. Impact/outcome."

**When to use:**
- After making a decision: store the reasoning and outcome
- When discovering a pattern: store the pattern and where it applies
- After fixing a bug: store the root cause and solution
- When learning user preferences: store what they prefer and why

**Examples:**
- store_memory({ content: "Chose PostgreSQL over MongoDB for user service. Need ACID for transactions.", tags: ["architecture", "database"], importance: 0.9 })
- store_memory({ content: "User prefers early returns over nested conditionals in validation code.", tags: ["code-style", "preferences"], importance: 0.7 })
- store_memory({ content: "Auth timeout fixed by adding retry with exponential backoff. Root cause: flaky network.", tags: ["bug-fix", "auth"], importance: 0.8 })`,
    annotations: {
      title: "Store Memory",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    inputSchema: {
      type: "object",
      properties: {
        content: {
          type: "string",
          description:
            "The memory content to store. Be specific: include context, reasoning, and outcome.",
        },
        tags: {
          type: "array",
          items: { type: "string" },
          description:
            'Tags to categorize the memory (e.g., ["project-name", "bug-fix", "auth"])',
        },
        importance: {
          type: "number",
          minimum: 0,
          maximum: 1,
          description:
            "Importance score: 0.9+ critical decisions, 0.7-0.9 patterns/bugs, 0.5-0.7 minor notes",
        },
        embedding: {
          type: "array",
          items: { type: "number" },
          description:
            "Optional embedding vector for semantic search (auto-generated if omitted)",
        },
        metadata: {
          type: "object",
          description:
            'Optional structured metadata (e.g., { files_modified: ["auth.ts"], error_type: "timeout" })',
        },
        timestamp: {
          type: "string",
          description: "Optional ISO timestamp (defaults to now)",
        },
      },
      required: ["content"],
    },
    outputSchema: {
      type: "object",
      properties: {
        memory_id: {
          type: "string",
          description:
            "Unique ID of the stored memory (use this for associations)",
        },
        message: {
          type: "string",
          description: "Confirmation message",
        },
      },
      required: ["memory_id", "message"],
    },
  },
  {
    name: "recall_memory",
    title: "Recall Memory",
    description: `Search and retrieve relevant memories using semantic search, keywords, tags, time filters, and graph expansion. This is the primary tool for accessing stored knowledge.

**When to use:**
- At conversation start: recall context about the current project/topic
- Before making decisions: check for past decisions on similar topics
- When debugging: search for similar past errors and their solutions
- When implementing: find established patterns and preferences
- For complex questions: use expand_entities for multi-hop reasoning

**Search strategies:**
- Semantic: Use natural language queries like "authentication timeout issues"
- Tags: Filter by project or category with tags: ["my-project", "bug-fix"]
- Time: Use time_query for recency like "last 7 days" or "today"
- Multi-query: Pass multiple queries in 'queries' array for broader recall
- Multi-hop: Use expand_entities=true for questions requiring connected reasoning

**Examples:**
- recall_memory({ query: "database architecture decisions", tags: ["my-project"], limit: 5 })
- recall_memory({ queries: ["auth patterns", "login flow", "JWT tokens"], limit: 10 })
- recall_memory({ tags: ["bug-fix"], time_query: "last 30 days", limit: 5 })
- recall_memory({ query: "What is Sarah's sister's job?", expand_entities: true })  // Multi-hop
- recall_memory({ query: "Python style preferences", language: "python", context: "coding-style" })`,
    annotations: {
      title: "Recall Memory",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "Semantic search query (natural language). Describe what you're looking for.",
        },
        queries: {
          type: "array",
          items: { type: "string" },
          description:
            "Multiple queries for broader recall. Results are deduplicated server-side.",
        },
        embedding: {
          type: "array",
          items: { type: "number" },
          description: "Optional embedding vector for direct similarity search",
        },
        limit: {
          type: "integer",
          minimum: 1,
          maximum: 50,
          default: 5,
          description:
            "Max memories to return (default: 5, increase for broader context)",
        },
        time_query: {
          type: "string",
          description:
            'Natural language time filter: "today", "yesterday", "last week", "last 30 days"',
        },
        start: {
          type: "string",
          description: "ISO timestamp lower bound (alternative to time_query)",
        },
        end: {
          type: "string",
          description: "ISO timestamp upper bound",
        },
        tags: {
          type: "array",
          items: { type: "string" },
          description:
            "Filter by tags. Use project name as first tag for scoping.",
        },
        tag_mode: {
          type: "string",
          enum: ["any", "all"],
          description:
            '"any" matches memories with any tag (default), "all" requires all tags',
        },
        tag_match: {
          type: "string",
          enum: ["exact", "prefix"],
          description:
            '"exact" for exact tag match (default), "prefix" for starts-with matching',
        },
        expand_entities: {
          type: "boolean",
          description:
            "Enable multi-hop reasoning via entity expansion. Finds memories about people/places mentioned in seed results. Use for \"What is X's sister's job?\" type questions.",
        },
        expand_relations: {
          type: "boolean",
          description:
            "Follow graph relationships from seed results to find related memories.",
        },
        auto_decompose: {
          type: "boolean",
          description:
            "Auto-extract entities and topics from query to generate supplementary searches.",
        },
        expansion_limit: {
          type: "integer",
          minimum: 1,
          maximum: 500,
          default: 25,
          description: "Max total expanded memories (default: 25)",
        },
        relation_limit: {
          type: "integer",
          minimum: 1,
          maximum: 200,
          default: 5,
          description: "Max relations to follow per seed memory (default: 5)",
        },
        expand_min_importance: {
          type: "number",
          minimum: 0,
          maximum: 1,
          description:
            "Minimum importance score for expanded results. Filters out low-relevance memories during graph/entity expansion. Recommended: 0.3-0.5 for broad context, 0.6-0.8 for focused results. Seed results are never filtered, only expanded ones.",
        },
        expand_min_strength: {
          type: "number",
          minimum: 0,
          maximum: 1,
          description:
            "Minimum relation strength to follow during graph expansion. Only traverses edges above this threshold. Recommended: 0.3 for exploratory, 0.6+ for high-confidence connections only. Does not affect entity expansion.",
        },
        context: {
          type: "string",
          description:
            'Context label (e.g., "coding-style", "architecture"). Boosts matching preferences.',
        },
        language: {
          type: "string",
          description:
            'Programming language hint (e.g., "python", "typescript"). Prioritizes language-specific memories.',
        },
        active_path: {
          type: "string",
          description:
            'Current file path for language auto-detection (e.g., "src/auth.ts")',
        },
        context_tags: {
          type: "array",
          items: { type: "string" },
          description:
            'Priority tags to boost in results (e.g., ["coding-style", "preferences"])',
        },
        context_types: {
          type: "array",
          items: { type: "string" },
          description:
            'Priority memory types to boost (e.g., ["Style", "Preference"])',
        },
        priority_ids: {
          type: "array",
          items: { type: "string" },
          description: "Specific memory IDs to ensure are included in results",
        },
      },
    },
    outputSchema: {
      type: "object",
      properties: {
        count: {
          type: "integer",
          description: "Number of memories returned",
        },
        results: {
          type: "array",
          description: "Array of matching memories with scores",
          items: {
            type: "object",
            properties: {
              memory_id: { type: "string" },
              content: { type: "string" },
              tags: { type: "array", items: { type: "string" } },
              importance: { type: "number" },
              final_score: { type: "number" },
              match_type: { type: "string" },
              created_at: { type: "string" },
            },
          },
        },
        dedup_removed: {
          type: "integer",
          description:
            "Number of duplicate results removed (when using multiple queries)",
        },
      },
      required: ["count", "results"],
    },
  },
  {
    name: "associate_memories",
    title: "Associate Memories",
    description: `Create a typed relationship between two memories. This builds a knowledge graph that improves recall by surfacing related context.

**When to use:**
- After storing a new memory: link it to related existing memories
- When a bug fix relates to an original feature implementation
- When a new decision updates or invalidates a previous one
- To connect patterns with their concrete examples

**Relationship types:**
- RELATES_TO: General relationship (default)
- LEADS_TO: Causal relationship (A caused B)
- DERIVED_FROM: Implementation of a decision/pattern
- EXEMPLIFIES: Concrete example of a pattern
- EVOLVED_INTO: Updated version of a concept
- INVALIDATED_BY: Superseded by another memory
- CONTRADICTS: Conflicts with another memory
- REINFORCES: Strengthens another memory's validity
- PART_OF: Component of a larger effort
- PREFERS_OVER: Chosen alternative
- OCCURRED_BEFORE: Temporal ordering

**Examples:**
- associate_memories({ memory1_id: "bug-fix-123", memory2_id: "feature-456", type: "RELATES_TO", strength: 0.9 })
- associate_memories({ memory1_id: "new-decision", memory2_id: "old-decision", type: "EVOLVED_INTO", strength: 0.8 })`,
    annotations: {
      title: "Associate Memories",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    inputSchema: {
      type: "object",
      properties: {
        memory1_id: {
          type: "string",
          description:
            "ID of the source memory (from store_memory response or recall results)",
        },
        memory2_id: {
          type: "string",
          description: "ID of the target memory to link to",
        },
        type: {
          type: "string",
          enum: [
            "RELATES_TO",
            "LEADS_TO",
            "OCCURRED_BEFORE",
            "PREFERS_OVER",
            "EXEMPLIFIES",
            "CONTRADICTS",
            "REINFORCES",
            "INVALIDATED_BY",
            "EVOLVED_INTO",
            "DERIVED_FROM",
            "PART_OF",
          ],
          description: "Relationship type (see tool description for meanings)",
        },
        strength: {
          type: "number",
          minimum: 0,
          maximum: 1,
          description:
            "Relationship strength: 0.9+ direct causation, 0.7-0.9 strong relation, 0.5-0.7 moderate",
        },
      },
      required: ["memory1_id", "memory2_id", "type", "strength"],
    },
    outputSchema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
          description: "Whether the association was created",
        },
        message: {
          type: "string",
          description: "Confirmation message",
        },
      },
      required: ["success", "message"],
    },
  },
  {
    name: "update_memory",
    title: "Update Memory",
    description: `Update an existing memory's content, tags, importance, or metadata. Use this to correct or enhance memories rather than storing duplicates.

**When to use:**
- To correct inaccurate information in a memory
- To add tags that were forgotten
- To adjust importance based on new understanding
- To add metadata after the fact

**Examples:**
- update_memory({ memory_id: "abc123", importance: 0.95 })  // Increase importance
- update_memory({ memory_id: "abc123", tags: ["project-x", "critical", "auth"] })  // Add tags
- update_memory({ memory_id: "abc123", content: "Updated: PostgreSQL chosen for ACID + team expertise" })`,
    annotations: {
      title: "Update Memory",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    inputSchema: {
      type: "object",
      properties: {
        memory_id: {
          type: "string",
          description:
            "ID of the memory to update (from store_memory or recall results)",
        },
        content: {
          type: "string",
          description: "New content (replaces existing)",
        },
        tags: {
          type: "array",
          items: { type: "string" },
          description: "New tags (replaces existing)",
        },
        importance: {
          type: "number",
          minimum: 0,
          maximum: 1,
          description: "New importance score",
        },
        metadata: {
          type: "object",
          description: "New metadata (merged with existing)",
        },
        timestamp: {
          type: "string",
          description: "Override creation timestamp",
        },
        updated_at: {
          type: "string",
          description: "Explicit update timestamp",
        },
        last_accessed: {
          type: "string",
          description: "Last access timestamp",
        },
        type: {
          type: "string",
          description: "Memory type classification",
        },
        confidence: {
          type: "number",
          minimum: 0,
          maximum: 1,
          description: "Confidence score for the memory",
        },
      },
      required: ["memory_id"],
    },
    outputSchema: {
      type: "object",
      properties: {
        memory_id: {
          type: "string",
          description: "ID of the updated memory",
        },
        message: {
          type: "string",
          description: "Confirmation message",
        },
      },
      required: ["memory_id", "message"],
    },
  },
  {
    name: "delete_memory",
    title: "Delete Memory",
    description: `Permanently delete a memory and its embedding. Use sparingly - consider updating instead.

**When to use:**
- Memory contains incorrect information that can't be corrected
- Memory is a duplicate
- Memory contains sensitive information that shouldn't persist
- Memory is no longer relevant and clutters recall results

**Example:**
- delete_memory({ memory_id: "abc123" })`,
    annotations: {
      title: "Delete Memory",
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
    inputSchema: {
      type: "object",
      properties: {
        memory_id: {
          type: "string",
          description:
            "ID of the memory to delete (from store_memory or recall results)",
        },
      },
      required: ["memory_id"],
    },
    outputSchema: {
      type: "object",
      properties: {
        memory_id: {
          type: "string",
          description: "ID of the deleted memory",
        },
        message: {
          type: "string",
          description: "Confirmation message",
        },
      },
      required: ["memory_id", "message"],
    },
  },
  {
    name: "check_database_health",
    title: "Check Database Health",
    description: `Check the health status of the AutoMem service and its connected databases (FalkorDB graph + Qdrant vectors).

**When to use:**
- Before a session to verify the memory service is available
- When memory operations are failing unexpectedly
- To check storage statistics

**Example:**
- check_database_health({})`,
    annotations: {
      title: "Check Database Health",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    inputSchema: {
      type: "object",
      properties: {},
    },
    outputSchema: {
      type: "object",
      properties: {
        status: {
          type: "string",
          enum: ["healthy", "error"],
          description: "Overall health status",
        },
        backend: {
          type: "string",
          description: "Backend type (automem)",
        },
        statistics: {
          type: "object",
          description: "Database statistics (memory counts, etc.)",
        },
        error: {
          type: "string",
          description: "Error message if status is error",
        },
      },
      required: ["status", "backend"],
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
      case "store_memory": {
        const storeArgs = args as unknown as StoreMemoryArgs;

        // Content size governance: reject if content exceeds hard limit
        const SOFT_LIMIT = 500;
        const HARD_LIMIT = 2000;
        const contentLength = storeArgs.content?.length || 0;
        let sizeWarning = "";

        // Hard limit: reject oversized content outright
        if (contentLength > HARD_LIMIT) {
          return {
            content: [
              {
                type: "text",
                text: `❌ Memory rejected: Content length (${contentLength} chars) exceeds hard limit (${HARD_LIMIT} chars).\n\nPlease split into smaller, focused memories or summarize the content before storing.`,
              },
            ],
            structuredContent: {
              error: "content_too_large",
              content_length: contentLength,
              hard_limit: HARD_LIMIT,
              message: `Content exceeds maximum allowed length of ${HARD_LIMIT} characters`,
            },
            isError: true,
          };
        }

        // Soft limit: warn that backend may auto-summarize
        if (contentLength > SOFT_LIMIT) {
          sizeWarning = `\n📝 Content length (${contentLength} chars) exceeds recommended size (${SOFT_LIMIT}). Backend may auto-summarize.`;
        }

        const result = await client.storeMemory(storeArgs);

        // Build response text
        let responseText = `Memory stored successfully!\n\nMemory ID: ${result.memory_id}`;
        if (result.message) {
          responseText += `\nMessage: ${result.message}`;
        }

        // Include summarization info if present
        const summarized = (result as any).summarized;
        const originalLength = (result as any).original_length;
        const summarizedLength = (result as any).summarized_length;
        if (summarized) {
          responseText += `\n📝 Auto-summarized: ${originalLength} → ${summarizedLength} chars`;
        } else if (sizeWarning) {
          responseText += sizeWarning;
        }

        const output = {
          memory_id: result.memory_id,
          message: result.message,
          ...(summarized && {
            summarized,
            original_length: originalLength,
            summarized_length: summarizedLength,
          }),
          ...(contentLength > SOFT_LIMIT && {
            content_length: contentLength,
            size_warning: true,
          }),
        };

        return {
          content: [
            {
              type: "text",
              text: responseText,
            },
          ],
          structuredContent: output,
        };
      }

      case "recall_memory": {
        const recallArgs = args as unknown as RecallMemoryArgs;

        const primary = await client.recallMemory(recallArgs);
        const merged = primary.results || [];
        const dedupRemoved = primary.dedup_removed || 0;
        const entityExpansion: any = primary.entity_expansion;
        const expansion: any = primary.expansion;

        if (!merged || merged.length === 0) {
          const emptyOutput = { results: [], count: 0 };
          return {
            content: [
              {
                type: "text",
                text: "No memories found matching your query.",
              },
            ],
            structuredContent: emptyOutput,
          };
        }

        const memoriesText = merged
          .map((item, index) => {
            const memory = item.memory;
            const tags = memory.tags?.length
              ? ` [${memory.tags.join(", ")}]`
              : "";
            const importance =
              typeof memory.importance === "number"
                ? ` (importance: ${memory.importance})`
                : "";
            const score =
              typeof item.final_score === "number"
                ? ` score=${item.final_score.toFixed(3)}`
                : "";
            const matchType = item.match_type ? ` [${item.match_type}]` : "";
            const relationNote =
              Array.isArray((item as any).relations) &&
              (item as any).relations.length
                ? ` relations=${(item as any).relations.length}`
                : "";
            const dedupNote =
              Array.isArray(item.deduped_from) && item.deduped_from.length
                ? ` (deduped x${item.deduped_from.length})`
                : "";
            const entityNote = item.expanded_from_entity
              ? ` [via entity: ${item.expanded_from_entity}]`
              : "";
            return `${index + 1}. ${
              memory.content
            }${tags}${importance}${score}${matchType}${relationNote}${entityNote}${dedupNote}\n   ID: ${
              memory.memory_id
            }\n   Created: ${memory.created_at}`;
          })
          .join("\n\n");

        // Build metadata notes
        const notes: string[] = [];
        if (dedupRemoved > 0) {
          notes.push(`${dedupRemoved} duplicates removed`);
        }
        if (entityExpansion?.enabled && entityExpansion.expanded_count > 0) {
          notes.push(
            `${entityExpansion.expanded_count} via entity expansion (${
              entityExpansion.entities_found?.join(", ") || "entities found"
            })`
          );
        }
        if (expansion?.enabled && expansion.expanded_count > 0) {
          notes.push(`${expansion.expanded_count} via relation expansion`);
        }
        const notesSuffix = notes.length > 0 ? ` (${notes.join("; ")})` : "";

        // Build structured output (must match outputSchema: results, count, dedup_removed)
        const recallOutput = {
          results: merged.map((item) => ({
            memory_id: item.memory.memory_id,
            content: item.memory.content,
            tags: item.memory.tags,
            importance: item.memory.importance,
            created_at: item.memory.created_at,
            final_score: item.final_score,
            match_type: item.match_type,
          })),
          count: merged.length,
          dedup_removed: dedupRemoved,
        };

        return {
          content: [
            {
              type: "text",
              text: `Found ${merged.length} memories${notesSuffix}:\n\n${memoriesText}`,
            },
          ],
          structuredContent: recallOutput,
        };
      }

      case "associate_memories": {
        const associateArgs = args as unknown as AssociateMemoryArgs;
        const result = await client.associateMemories(associateArgs);
        const output = { success: true, message: result.message };
        return {
          content: [
            {
              type: "text",
              text: `Association created successfully!\n\nMessage: ${result.message}`,
            },
          ],
          structuredContent: output,
        };
      }

      case "update_memory": {
        const updateArgs = args as unknown as UpdateMemoryArgs;
        const result = await client.updateMemory(updateArgs);
        const output = {
          memory_id: result.memory_id,
          message: `Memory ${result.memory_id} updated successfully!`,
        };
        return {
          content: [
            {
              type: "text",
              text: `Memory ${result.memory_id} updated successfully!`,
            },
          ],
          structuredContent: output,
        };
      }

      case "delete_memory": {
        const deleteArgs = args as unknown as DeleteMemoryArgs;
        const result = await client.deleteMemory(deleteArgs);
        const output = {
          memory_id: result.memory_id,
          message: `Memory ${result.memory_id} deleted successfully!`,
        };
        return {
          content: [
            {
              type: "text",
              text: `Memory ${result.memory_id} deleted successfully!`,
            },
          ],
          structuredContent: output,
        };
      }

      case "check_database_health": {
        const health = await client.checkHealth();
        const statusEmoji = health.status === "healthy" ? "✅" : "❌";

        let statsText = "";
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

        const errorText = health.error ? `\nError: ${health.error}` : "";

        const output = {
          status: health.status,
          backend: health.backend,
          statistics: health.statistics,
          error: health.error,
        };

        return {
          content: [
            {
              type: "text",
              text: `${statusEmoji} AutoMem Health Status\n\nStatus: ${health.status}\nBackend: ${health.backend}${statsText}${errorText}`,
            },
          ],
          structuredContent: output,
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error occurred";
    return {
      content: [
        {
          type: "text",
          text: `Error: ${errorMessage}`,
        },
      ],
      isError: true,
    };
  }
});

const prompts = [
  {
    name: "session-start",
    description: "Recall relevant context at the start of a session",
    arguments: [
      {
        name: "project",
        description: "Project name or topic to focus recall on",
        required: false,
      },
    ],
  },
  {
    name: "store-decision",
    description: "Store an important decision with proper tags and rationale",
    arguments: [
      {
        name: "decision",
        description: "The decision that was made",
        required: true,
      },
      {
        name: "rationale",
        description: "Why this decision was made",
        required: false,
      },
      {
        name: "alternatives",
        description: "Alternatives that were considered",
        required: false,
      },
    ],
  },
  {
    name: "find-related",
    description: "Find memories related to a specific topic or concept",
    arguments: [
      {
        name: "topic",
        description: "Topic to search for",
        required: true,
      },
      {
        name: "time_range",
        description: 'Time range to search (e.g., "last week", "today")',
        required: false,
      },
    ],
  },
];

server.setRequestHandler(ListPromptsRequestSchema, async () => ({
  prompts,
}));

server.setRequestHandler(GetPromptRequestSchema, async (request) => {
  const { name, arguments: promptArgs } = request.params;

  switch (name) {
    case "session-start": {
      const project = promptArgs?.project || "";
      const projectFilter = project ? ` related to "${project}"` : "";
      return {
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: `Start of new session. Please recall relevant context${projectFilter} to help with this conversation.

Use the recall_memory tool to:
1. Search for recent decisions and patterns${projectFilter}
2. Find any relevant bug fixes or issues${projectFilter}
3. Retrieve user preferences and habits

Example queries to try:
- recall_memory({ query: "recent decisions", tags: ["decision"], time_query: "last week" })
- recall_memory({ query: "patterns best practices", tags: ["pattern"] })
- recall_memory({ tags: ["preference", "habit"], tag_mode: "any" })

Summarize the key context you found that might be relevant to our conversation.`,
            },
          },
        ],
      };
    }

    case "store-decision": {
      const decision = promptArgs?.decision || "[DECISION]";
      const rationale = promptArgs?.rationale || "";
      const alternatives = promptArgs?.alternatives || "";

      let content = `Store this decision in memory:\n\nDecision: ${decision}`;
      if (rationale) content += `\nRationale: ${rationale}`;
      if (alternatives) content += `\nAlternatives considered: ${alternatives}`;

      content += `\n\nUse the store_memory tool with:\n- content: A clear summary combining the decision, rationale, and alternatives\n- tags: [\"decision\", plus relevant domain tags like \"architecture\", \"api\", \"database\", etc.]\n- importance: 0.8-0.9\n- metadata: { rationale: \"...\", alternatives: [\"...\"] }`;

      return {
        messages: [
          {
            role: "user",
            content: { type: "text", text: content },
          },
        ],
      };
    }

    case "find-related": {
      const topic = promptArgs?.topic || "";
      const timeRange = promptArgs?.time_range || "";
      const timeText = timeRange ? `, time_query: \"${timeRange}\"` : "";

      return {
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: `Find memories related to: "${topic}".\n\nUse recall_memory({ query: \"${topic}\"${timeText}, limit: 10 }). Then summarize the most relevant results and note any useful tags or follow-up queries.`,
            },
          },
        ],
      };
    }

    default:
      throw new Error(`Unknown prompt: ${name}`);
  }
});

async function main() {
  installStdioErrorGuards();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  if (process.env.AUTOMEM_LOG_LEVEL === "debug") {
    console.error("AutoMem MCP server running");
  }
}

main().catch((error) => {
  console.error("Server error:", error);
  process.exit(1);
});
