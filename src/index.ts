#!/usr/bin/env node
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { config } from "dotenv";
import { runConfig, runSetup } from "./cli/setup.js";
import { runClaudeCodeSetup } from "./cli/claude-code.js";
import { runCursorSetup } from "./cli/cursor.js";
import { runCodexSetup } from "./cli/codex.js";
import { runOpenClawSetup } from "./cli/openclaw.js";
import { runMigrateCommand } from "./cli/migrate.js";
import { runUninstallCommand } from "./cli/uninstall.js";
import { runQueueCommand } from "./cli/queue.js";
import { AutoMemClient } from "./automem-client.js";
import { readAutoMemApiKeyFromEnv } from "./env.js";
import { buildRecallMemoryResponse } from "./recall-memory.js";
import { AUTHORABLE_RELATION_TYPES, MEMORY_TYPES, RELATION_TYPE_METADATA } from "./types.js";
import type {
  AutoMemConfig,
  StoreMemoryArgs,
  RecallMemoryArgs,
  AssociateMemoryArgs,
  UpdateMemoryArgs,
  DeleteMemoryArgs,
} from "./types.js";

function isInteractiveTerminal(): boolean {
  return Boolean(process.stdout.isTTY && process.stderr.isTTY);
}

const command = (process.argv[2] || "").toLowerCase();
const isServerMode = command.length === 0;
const isMachineReadableCommand =
  command === "config" && process.argv.slice(3).some(
    (arg) => arg === "--json" || arg === "--format=json" || arg === "--format"
  );
const shouldSilenceDotenv = isServerMode || isMachineReadableCommand;

// Prevent dotenv from writing its banner to stdout when the caller expects clean
// machine-readable output (stdio server mode, or `config --format=json`).
process.env.DOTENV_CONFIG_QUIET = shouldSilenceDotenv ? "true" : process.env.DOTENV_CONFIG_QUIET ?? "false";
process.env.DOTENV_CONFIG_DEBUG = "false";

if (isServerMode) {
  const logToStderr = (...args: unknown[]) => console.error(...args);
  console.log = logToStderr;
  console.info = logToStderr;
  console.debug = logToStderr;
  console.warn = logToStderr;
}

config({ quiet: shouldSilenceDotenv });

// Optional: allow upstream supervisors (AutoHub, etc.) to set a stable process title for safe cleanup.
// This prevents "kill by package name" from taking down other running MCP clients (Codex/Cursor/etc.).
try {
  const tag = String(
    process.env.AUTOMEM_PROCESS_TAG || process.env.MCP_PROCESS_TAG || ""
  ).trim();
  if (tag) {
    process.title = tag.startsWith("mcp-automem") ? tag : `mcp-automem:${tag}`;
    if (process.env.AUTOMEM_LOG_LEVEL === "debug" || isInteractiveTerminal()) {
      console.error("[mcp-automem] process.title:", process.title);
    }
  }
} catch {
  // Best-effort only
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
  codex              Set up AutoMem for Codex
  openclaw           Set up AutoMem for OpenClaw
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

OPENCLAW SETUP:
  npx @verygoodplugins/mcp-automem openclaw [options]

  Recommended happy path:
    curl -fsSL https://automem.ai/install.sh | bash

  Options:
    --mode <plugin|mcp|skill>   Integration mode (default: plugin)
    --scope <workspace|shared>  Install scope for mcp/skill modes (default: workspace)
    --workspace <path>          OpenClaw workspace directory (auto-detected)
    --endpoint <url>            AutoMem endpoint (default: http://127.0.0.1:8001)
    --api-key <key>             AutoMem API key (optional)
    --plugin-source <spec>      npm spec or path for plugin installs
    --name <name>               Project name used to seed default memory tags
    --replace-memory            Disable OpenClaw's built-in memory layer and use AutoMem as the only memory system
    --dry-run                   Show what would be changed
    --quiet                     Suppress output

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

if (command === "openclaw") {
  await runOpenClawSetup(process.argv.slice(3));
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
  const AUTOMEM_API_URL =
    process.env.AUTOMEM_API_URL ||
    process.env.AUTOMEM_ENDPOINT ||
    "http://127.0.0.1:8001";
  const AUTOMEM_API_KEY = readAutoMemApiKeyFromEnv();

  const client = new AutoMemClient({
    endpoint: AUTOMEM_API_URL,
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

const AUTOMEM_API_URL =
  process.env.AUTOMEM_API_URL ||
  process.env.AUTOMEM_ENDPOINT ||
  "http://127.0.0.1:8001";
const AUTOMEM_API_KEY = readAutoMemApiKeyFromEnv();

if (!process.env.AUTOMEM_API_URL && !process.env.AUTOMEM_ENDPOINT) {
  if (isInteractiveTerminal()) {
    console.warn(
      "⚠️  AUTOMEM_API_URL not set. Run `npx @verygoodplugins/mcp-automem setup` or export the environment variable before connecting."
    );
  }
} else if (!process.env.AUTOMEM_API_URL && process.env.AUTOMEM_ENDPOINT) {
  console.warn(
    "⚠️  AUTOMEM_ENDPOINT is deprecated; rename it to AUTOMEM_API_URL. The old name still works for now."
  );
}

const clientConfig: AutoMemConfig = {
  endpoint: AUTOMEM_API_URL,
  apiKey: AUTOMEM_API_KEY,
};

const client = new AutoMemClient(clientConfig);

const server = new Server(
  { name: "mcp-automem", version: PACKAGE_VERSION },
  { capabilities: { tools: {} } }
);

const tools: Tool[] = [
  {
    name: "store_memory",
    title: "Store Memory",
    description: `Store memory in one of two modes — single-memory (set top-level \`content\`) or batch (set \`memories: [...]\` for up to 500). Use this to persist important information for future recall.

**Mode 1 — Single (default):** pass top-level \`content\` plus any optional fields (tags, importance, metadata, type, confidence, embedding, t_valid, t_invalid, id, etc.).

**Mode 2 — Batch:** pass \`memories: [{ content, tags?, importance?, metadata?, timestamp?, type?, confidence? }, ...]\` to store up to 500 memories in one request. Faster for bulk ingestion (imports, benchmark seeding). Batch mode does NOT accept \`id\`, \`embedding\`, \`t_valid\`, or \`t_invalid\` per-item — use single mode for those.

**Content size guidelines (per item):**
- Target: 150-300 characters (one meaningful paragraph)
- Maximum: 500 characters (auto-summarized if exceeded)
- Hard limit: 2000 characters (rejected)
- Format: "Brief title. Context and details. Impact/outcome."

**When to use:**
- After making a decision: store the reasoning and outcome
- When discovering a pattern: store the pattern and where it applies
- After fixing a bug: store the root cause and solution
- When learning user preferences: store what they prefer and why
- For bulk ingestion (imports, seeding): use batch mode

**Examples:**
- store_memory({ content: "Chose PostgreSQL over MongoDB for user service. Need ACID for transactions.", tags: ["architecture", "database"], importance: 0.9 })
- store_memory({ content: "User prefers early returns over nested conditionals.", tags: ["code-style"], importance: 0.7 })
- store_memory({ memories: [{ content: "...", tags: ["import"] }, { content: "...", tags: ["import"] }] })  // Batch`,
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
            "Single-memory mode (XOR with `memories`). The memory content to store. Be specific: include context, reasoning, and outcome.",
        },
        memories: {
          type: "array",
          maxItems: 500,
          description:
            "Batch mode (XOR with `content`). Up to 500 memory objects to store in one call. Each item supports content (required), tags, importance, timestamp, type, confidence, metadata. Batch mode does NOT support `id`, `embedding`, `t_valid`, or `t_invalid` per-item — use single-memory mode for those.",
          items: {
            type: "object",
            required: ["content"],
            properties: {
              content: { type: "string" },
              tags: { type: "array", items: { type: "string" } },
              importance: { type: "number", minimum: 0, maximum: 1 },
              timestamp: { type: "string" },
              type: { type: "string", enum: [...MEMORY_TYPES] },
              confidence: { type: "number", minimum: 0, maximum: 1 },
              metadata: { type: "object" },
            },
          },
        },
        tags: {
          type: "array",
          items: { type: "string" },
          description:
            'Single-memory mode. Tags to categorize the memory (e.g., ["project-name", "bug-fix", "auth"])',
        },
        importance: {
          type: "number",
          minimum: 0,
          maximum: 1,
          description:
            "Single-memory mode. Importance: 0.9+ critical decisions, 0.7-0.9 patterns/bugs, 0.5-0.7 minor notes",
        },
        embedding: {
          type: "array",
          items: { type: "number" },
          description:
            "Single-memory mode only. Optional embedding vector for semantic search (auto-generated if omitted). Not supported in batch mode.",
        },
        metadata: {
          type: "object",
          description:
            'Single-memory mode. Optional structured metadata (e.g., { files_modified: ["auth.ts"], error_type: "timeout" })',
        },
        timestamp: {
          type: "string",
          description: "Single-memory mode. Optional ISO timestamp (defaults to now)",
        },
        type: {
          type: "string",
          enum: [...MEMORY_TYPES],
          description: "Single-memory mode. Memory type for classification",
        },
        confidence: {
          type: "number",
          minimum: 0,
          maximum: 1,
          description:
            "Single-memory mode. Classification confidence (0-1, default 0.9 when type provided)",
        },
        id: {
          type: "string",
          description:
            "Single-memory mode only. Custom memory ID (auto-generated if omitted). Not supported in batch mode.",
        },
        t_valid: {
          type: "string",
          description:
            "Single-memory mode only. ISO 8601 timestamp when the memory becomes valid. Not supported in batch mode.",
        },
        t_invalid: {
          type: "string",
          description:
            "Single-memory mode only. ISO 8601 timestamp when the memory expires. Not supported in batch mode.",
        },
        updated_at: {
          type: "string",
          description: "Single-memory mode. ISO 8601 last-updated timestamp",
        },
        last_accessed: {
          type: "string",
          description: "Single-memory mode. ISO 8601 last-accessed timestamp",
        },
      },
    },
    outputSchema: {
      type: "object",
      properties: {
        memory_id: {
          type: "string",
          description:
            "Single-mode result: unique ID of the stored memory (use for associations)",
        },
        memory_ids: {
          type: "array",
          items: { type: "string" },
          description: "Batch-mode result: IDs of the stored memories.",
        },
        stored: {
          type: "integer",
          description: "Batch-mode result: number of memories stored.",
        },
        qdrant: {
          type: "string",
          description: "Batch-mode result: Qdrant indexing summary from the server.",
        },
        enrichment: {
          type: "string",
          description: "Batch-mode result: enrichment status from the server.",
        },
        query_time_ms: {
          type: "number",
          description: "Batch-mode result: server-reported execution time in milliseconds.",
        },
        message: {
          type: "string",
          description: "Confirmation message",
        },
      },
      required: ["message"],
    },
  },
  {
    name: "recall_memory",
    title: "Recall Memory",
    description: `Recall memories from AutoMem in one of three modes. The mode is selected by which params you pass.

**Mode 1 — ID fetch:** pass \`memory_id\` to retrieve a single memory by ID. All other params are ignored. Routes to GET /memory/{id} and updates last_accessed.

**Mode 2 — Tag enumeration:** pass \`tags\` + \`exhaustive: true\` for paginated exact-match listing (NOT ranked retrieval). Use this for cleanup/audit workflows where ranked retrieval silently undercounts large tag sets. Pair with \`limit\` (≤200) and \`offset\`. Returns \`has_more\`/\`limit\`/\`offset\` page metadata. Tag matching is exact, case-insensitive, any-of mode — \`tag_match: "prefix"\` and \`tag_mode: "all"\` are rejected in this mode.

**Mode 3 — Ranked retrieval (default):** hybrid search across vector, keyword, tags, recency, and optional graph expansion. The primary tool for finding relevant context.

**When to use ranked (mode 3):**
- At conversation start: recall context about the current project/topic
- Before making decisions: check for past decisions on similar topics
- When debugging: search for similar past errors and their solutions
- For complex questions: use \`expand_entities\` for multi-hop reasoning

**When to use enumeration (mode 2):** when you need to know *how many* memories carry a tag, or to walk all of them for cleanup/migration. Ranked recall ignores low-importance hits — enumeration does not.

**Examples:**
- recall_memory({ query: "database architecture decisions", tags: ["my-project"], limit: 5 })
- recall_memory({ memory_id: "abc123" })  // Mode 1
- recall_memory({ tags: ["benchmark-test"], exhaustive: true, limit: 50 })  // Mode 2
- recall_memory({ tags: ["benchmark-test"], exhaustive: true, limit: 50, offset: 50 })  // Mode 2 page 2
- recall_memory({ query: "auth", exclude_tags: ["deprecated"] })  // Mode 3 with exclusion
- recall_memory({ query: "What is Sarah's sister's job?", expand_entities: true })  // Mode 3 multi-hop`,
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
        memory_id: {
          type: "string",
          description:
            "MODE: ID fetch. When set, fetches the single memory by ID and IGNORES all other params. Routes to GET /memory/{id}; updates last_accessed.",
        },
        exhaustive: {
          type: "boolean",
          description:
            "MODE: tag enumeration. When true, requires non-empty `tags`. Routes to GET /memory/by-tag for paginated exact-match listing — NOT ranked retrieval. Use for cleanup/audit workflows where ranked recall undercounts. `limit` is clamped to 200. `tag_match: \"prefix\"` and `tag_mode: \"all\"` are rejected in this mode.",
        },
        exclude_tags: {
          type: "array",
          items: { type: "string" },
          description:
            "Ranked-mode only. Tags to exclude from results (any match excludes). Independent of `tag_match` — supports both exact and prefix matching internally on the server.",
        },
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
          maximum: 200,
          default: 5,
          description:
            "Max memories to return. Schema allows 1–200; in enumeration mode (`exhaustive: true`) the server honors up to 200, while ranked mode is typically clamped server-side to ~50. Default 5.",
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
        per_query_limit: {
          type: "integer",
          minimum: 1,
          maximum: 50,
          description:
            "Per-query result limit when using queries[] (default: 5)",
        },
        sort: {
          type: "string",
          enum: [
            "score",
            "time_desc",
            "time_asc",
            "updated_desc",
            "updated_asc",
          ],
          description:
            "Result ordering (use time_* for chronological recaps)",
        },
        format: {
          type: "string",
          enum: ["text", "items", "detailed", "json"],
          default: "text",
          description:
            'Output format: text (default), items (per-memory), detailed (with metadata), json (raw)',
        },
        offset: {
          type: "integer",
          minimum: 0,
          description: "Result offset for pagination",
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
        mode: {
          type: "string",
          enum: ["ranked", "enumeration", "id_fetch"],
          description: "Mode that produced the result.",
        },
        has_more: {
          type: "boolean",
          description:
            "Enumeration mode only: true if more pages exist past `offset + limit`.",
        },
        limit: {
          type: "integer",
          description: "Enumeration mode only: page size used for this response.",
        },
        offset: {
          type: "integer",
          description: "Enumeration mode only: offset used for this response.",
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

**Authorable relationship types:**
${Object.entries(RELATION_TYPE_METADATA).map(([k, v]) => `- ${k}: ${v}`).join('\n')}

**Read-only/internal relations:**
- System/internal relations such as SIMILAR_TO, PRECEDED_BY, EXPLAINS, SHARES_THEME, PARALLEL_CONTEXT, and DISCOVERED may appear in recall results, but they are not valid inputs for associate_memories.

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
          enum: [...AUTHORABLE_RELATION_TYPES],
          description: "Relationship type between the two memories",
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
          enum: [...MEMORY_TYPES],
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
    description: `Delete a memory by ID (\`memory_id\`) or bulk-delete by tag (\`tags\`). Use sparingly — consider \`update_memory\` instead.

**Mode 1 — Single (default):** pass \`memory_id\` to delete one memory and its embedding. Idempotent: re-running on the same ID is a no-op.

**Mode 2 — Bulk-by-tag:** pass \`tags: [...]\` to delete ALL memories tagged with ANY of these tags. Tag matching is exact (case-insensitive), any-of mode. There is NO dry-run. This can delete thousands of memories in one call. NOT idempotent in practice — re-running may catch new memories that were tagged the same way after the first call. Verify with \`recall_memory({ tags, exhaustive: true })\` first if uncertain.

**When to use:**
- Memory contains incorrect information that can't be corrected (Mode 1)
- Memory is a duplicate (Mode 1)
- Cleanup of benchmark/test data scoped by tag (Mode 2)
- Removing all memories under a deprecated tag namespace (Mode 2)

**Examples:**
- delete_memory({ memory_id: "abc123" })  // Mode 1
- delete_memory({ tags: ["benchmark-test"] })  // Mode 2, bulk by tag`,
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
            "Single-delete mode (XOR with `tags`). ID of the memory to delete (from store_memory or recall results).",
        },
        tags: {
          type: "array",
          items: { type: "string" },
          description:
            "Bulk-delete mode (XOR with `memory_id`). Bulk-deletes ALL memories tagged with ANY of these tags. Exact match, case-insensitive. No dry-run.",
        },
      },
    },
    outputSchema: {
      type: "object",
      properties: {
        memory_id: {
          type: "string",
          description: "Single-delete result: ID of the deleted memory.",
        },
        deleted_count: {
          type: "integer",
          description: "Bulk-delete result: number of memories deleted.",
        },
        tags: {
          type: "array",
          items: { type: "string" },
          description: "Bulk-delete result: tags that were used for the bulk delete.",
        },
        message: {
          type: "string",
          description: "Confirmation message",
        },
      },
      required: ["message"],
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

        // Content size governance applies to single-store mode only.
        // Batch mode pushes governance into the per-item content trim and the server's auto-summarize.
        const SOFT_LIMIT = 500;
        const HARD_LIMIT = 2000;
        const isBatchMode = Array.isArray(storeArgs.memories);
        const contentLength = isBatchMode ? 0 : (storeArgs.content?.length || 0);
        let sizeWarning = "";

        if (!isBatchMode) {
          // Hard limit: reject oversized content outright (single mode only)
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
        }

        const result = await client.storeMemory(storeArgs);

        if (isBatchMode) {
          const stored = result.stored ?? result.memory_ids?.length ?? 0;
          const ids = result.memory_ids ?? [];
          const idPreview = ids.length > 10
            ? `${ids.slice(0, 10).join(', ')}, …(+${ids.length - 10})`
            : ids.join(', ');
          const output = {
            stored,
            memory_ids: ids,
            message: result.message,
            ...(result.qdrant ? { qdrant: result.qdrant } : {}),
            ...(result.enrichment ? { enrichment: result.enrichment } : {}),
            ...(typeof result.query_time_ms === 'number'
              ? { query_time_ms: result.query_time_ms }
              : {}),
          };
          return {
            content: [
              {
                type: "text",
                text: `Stored ${stored} memories.${idPreview ? `\nIDs: ${idPreview}` : ''}\nMessage: ${result.message}`,
              },
            ],
            structuredContent: output,
          };
        }

        // Single-store mode response
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
        return buildRecallMemoryResponse(
          client,
          args as unknown as RecallMemoryArgs
        );
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

        if (typeof result.deleted_count === 'number') {
          // Bulk-delete-by-tag mode
          const tags = result.tags ?? deleteArgs.tags ?? [];
          const output = {
            deleted_count: result.deleted_count,
            tags,
            message: result.message,
          };
          return {
            content: [
              {
                type: "text",
                text: `Bulk delete complete: removed ${result.deleted_count} memor${result.deleted_count === 1 ? 'y' : 'ies'} matching tag(s) ${tags.join(', ')}.`,
              },
            ],
            structuredContent: output,
          };
        }

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
