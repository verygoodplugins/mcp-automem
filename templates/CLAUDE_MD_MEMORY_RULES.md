# AutoMem Memory Rules for CLAUDE.md

This template provides AI instructions for automatic memory management with AutoMem. Add this section to your `~/.claude/CLAUDE.md` file to enable intelligent memory storage and recall.

> **For complete integration details**, see [CLAUDE_CODE_INTEGRATION.md](CLAUDE_CODE_INTEGRATION.md) which explains:
> - How the hook system works
> - What files get modified during installation
> - The memory queue and processing pipeline
> - Expected behavior and troubleshooting

> Important: The default installation is lean and quiet. Automatic capture hooks are optional and should be enabled only if you want them. Avoid auto-storing content unless the signal is clearly high or you have explicitly opted in.

## Quick Installation

```bash
cat templates/CLAUDE_MD_MEMORY_RULES.md >> ~/.claude/CLAUDE.md
```

Or manually copy the `<memory_rules>` section below to `~/.claude/CLAUDE.md`

## Memory Rules Template

Add this to your `~/.claude/CLAUDE.md` file:

```markdown
<memory_rules>
MEMORY MCP USAGE - ENHANCED AUTOMEM INTEGRATION

SESSION INITIALIZATION (CRITICAL - DO THIS FIRST):
At the start of EVERY session:
1. Detect project context from working directory
2. Load relevant memories:
   - mcp__memory__recall_memory({
       query: "project: [detected project name]",
       limit: 20,
       time_query: "last 7 days"
     })
3. Load user preferences:
   - mcp__memory__recall_memory({
       tags: ["preference", "workflow", "style"],
       limit: 30
     })
4. Check for recent errors/solutions in this project:
   - mcp__memory__recall_memory({
       query: "[project name] error OR bug OR issue",
       tags: ["error", "solution"],
       limit: 10,
       time_query: "last 24 hours"
     })
5. If continuing previous work, load session context:
   - mcp__memory__recall_memory({
       query: "session incomplete OR todo OR in-progress",
       limit: 10,
       time_query: "last 4 hours"
     })

PIPELINE GUARANTEES (ENABLED AUTOMATICALLY):
- Queue processor now deduplicates by content before storing; redundant memories are skipped safely.
- Stored batches automatically create OCCURRED_BEFORE links plus explicit relationships when metadata requests `relatesTo`.
- MCP tooling map: `store_memory`, `recall_memory`, `associate_memories`, `update_memory`, `delete_memory`, `check_database_health`
- Tag-based search uses `recall_memory` with tags parameter (no separate tag search tool)

MEMORY SCHEMA WITH AUTOMEM:
All memories now support:
- importance: 0.0-1.0 score (critical: 0.9+, important: 0.7-0.8, standard: 0.5-0.6, minor: <0.5)
- embedding: 768-dimensional vector (auto-generated if OPENAI_API_KEY set)
- type: Decision|Pattern|Preference|Style|Habit|Insight|Context|Memory
- relationships: 11 types for connecting related memories

Store Automatically (opt-in):
After fixing any bug:
- mcp__memory__store_memory: {
    content: "Fixed [issue] in [project] by [solution]",
    tags: ["bugfix", "project-name", "component"],
    importance: 0.7,  # Higher if critical bug
    type: "Insight"
  }

After implementing a feature:
- mcp__memory__store_memory: {
    content: "Implemented [feature] using [approach]",
    tags: ["feature", "project-name", "pattern"],
    importance: 0.8,  # Features are important
    type: "Pattern"
  }

When user states a preference:
- mcp__memory__store_memory: {
    content: "User preference: [exact quote]",
    tags: ["preference", "workflow"],
    importance: 0.9,  # User preferences are critical
    type: "Preference"
  }

After making architectural decision:
- mcp__memory__store_memory: {
    content: "Decided to [choice] because [rationale]",
    tags: ["decision", "architecture", "project-name"],
    importance: 0.9,
    type: "Decision"
  }

When discovering coding patterns:
- mcp__memory__store_memory: {
    content: "Pattern: [description] in [context]",
    tags: ["pattern", "style", "language"],
    importance: 0.6,
    type: "Style"
  }

After error resolution:
- mcp__memory__store_memory: {
    content: "Error: [message] Solution: [fix] Root cause: [analysis]",
    tags: ["error", "solution", "tool-name"],
    importance: 0.7,
    type: "Insight"
  }

After successful refactoring:
- mcp__memory__store_memory: {
    content: "Refactored [component]: [before] → [after] for [reason]",
    tags: ["refactor", "pattern", "project-name"],
    importance: 0.6,
    type: "Pattern"
  }

When learning new API/library:
- mcp__memory__store_memory: {
    content: "Learned: [library] usage: [pattern/example]",
    tags: ["learning", "api", library-name, "pattern"],
    importance: 0.7,
    type: "Pattern"
  }

After performance optimization:
- mcp__memory__store_memory: {
    content: "Optimized [what]: [metric] improved from [before] to [after] by [technique]",
    tags: ["optimization", "performance", "metric"],
    importance: 0.8,
    type: "Insight"
  }

When discovering security issue:
- mcp__memory__store_memory: {
    content: "Security: Found [vulnerability type] in [location]. Fixed by [mitigation]",
    tags: ["security", "vulnerability", "fix", "critical"],
    importance: 0.95,  # Security is critical
    type: "Insight"
  }

After debugging session:
- mcp__memory__store_memory: {
    content: "Debug: [issue] caused by [root cause]. Diagnostic: [how found]. Prevention: [strategy]",
    tags: ["debug", "diagnostic", "prevention"],
    importance: 0.7,
    type: "Insight"
  }

When user corrects Claude:
- mcp__memory__store_memory: {
    content: "Correction: User clarified [topic]: [correct approach]",
    tags: ["correction", "learning", "user-feedback"],
    importance: 0.9,  # User corrections are critical
    type: "Preference"
  }

After successful deployment:
- mcp__memory__store_memory: {
    content: "Deployed [project/feature] to [environment]: [outcome/metrics]",
    tags: ["deployment", environment, "project-name"],
    importance: 0.8,
    type: "Context"
  }

AUTOMATICALLY RETRIEVE (enhanced with AutoMem RAG):
AutoMem uses hybrid scoring that combines:
- Vector similarity (semantic search via Qdrant)
- Keyword matching (text search in FalkorDB)
- Tag overlap scoring
- Recency scoring (newer memories score higher)
- Exact match bonuses

At session start:
1. Recall project context with hybrid search:
   mcp__memory__recall_memory: {
     query: "[project name] [current task]",
     embedding: [768-dim vector if OPENAI_KEY set],
     limit: 15,
     time_query: "last 30 days"
   }
2. Follow graph relationships for additional context
3. Load user preferences: recall_memory(tags=["preference", "workflow"])

When encountering errors:
- Semantic + keyword search:
  mcp__memory__recall_memory: {
    query: "[error message keywords]",
    embedding: [error context vector],
    limit: 10,
    tags: ["error", "solution", "bugfix"]
  }
- Traverse LEADS_TO relationships for proven solutions
- Check INVALIDATED_BY for outdated fixes

Before implementing features:
- Pure semantic search for similar implementations:
  mcp__memory__recall_memory: {
    embedding: [feature description vector],
    limit: 20,
    tags: ["pattern", "implementation", "architecture"]
  }
- Find memories that REINFORCE best practices
- Identify CONTRADICTS relationships to avoid conflicts

For code patterns:
- mcp__memory__recall_memory: {
    tags: ["pattern", language, framework],
    limit: 50
  }

MEMORY RELATIONSHIPS (use mcp__memory__associate_memories):
- RELATES_TO: General connection
- LEADS_TO: Causal (bug→solution)
- OCCURRED_BEFORE: Temporal sequence
- PREFERS_OVER: User/team preferences
- EXEMPLIFIES: Pattern examples
- CONTRADICTS: Conflicting approaches
- REINFORCES: Supporting evidence
- INVALIDATED_BY: Outdated information
- EVOLVED_INTO: Knowledge evolution
- DERIVED_FROM: Source relationships
- PART_OF: Hierarchical structure

IMPORTANCE SCORING GUIDELINES:
0.9-1.0: Critical decisions, user preferences, security fixes
0.7-0.8: Features, important bugs, architectural patterns
0.5-0.6: Standard patterns, regular workflows, common solutions
0.3-0.4: Minor optimizations, style preferences, routine tasks
0.0-0.2: Temporary information, soon to be deprecated

MEMORY TYPE CLASSIFICATION:
- Decision: Strategic choices with rationale
- Pattern: Recurring approaches and implementations
- Preference: User/team preferences and settings
- Style: Code style and formatting patterns
- Habit: Regular workflows and practices
- Insight: Learned knowledge and discoveries
- Context: Project/environment information
- Memory: Default/general memories

MEMORY LIFECYCLE MANAGEMENT:
Update evolving knowledge:
- mcp__memory__update_memory: {
    memory_id: "existing_id",
    content: "Updated understanding: [new insight]",
    importance: 0.9,  # Boost for fresh knowledge
    metadata: { updated_reason: "learned [what]" }
  }

Deprecate outdated information:
- mcp__memory__update_memory: {
    memory_id: "old_memory_id",
    importance: 0.1,  # Decay obsolete knowledge
    metadata: { deprecated: true, replaced_by: "new_memory_id" }
  }
- Create INVALIDATED_BY relationship to new memory

Delete duplicate/irrelevant:
- First check for duplicates:
  mcp__memory__recall_memory: {
    query: "[exact content keywords]",
    limit: 5
  }
- If duplicate found: mcp__memory__delete_memory(memory_id)

MEMORY ANALYTICS & GRAPH NAVIGATION:
Explore memory connections:
1. Start from a memory, traverse its relationships:
   - Find root memory → follow LEADS_TO for consequences
   - Find solution → traverse back via DERIVED_FROM for context
   - Find pattern → explore EXEMPLIFIES for examples

2. Analyze memory clusters:
   - Search by tag combinations to find related groups
   - Look for memories with 3+ relationships (knowledge hubs)
   - Identify contradiction clusters via CONTRADICTS edges

3. Track memory evolution:
   - Follow EVOLVED_INTO chains to see knowledge progression
   - Check INVALIDATED_BY to avoid outdated approaches
   - Use REINFORCES to find validated patterns

ENRICHMENT PIPELINE (AUTOMATIC):
AutoMem enriches every stored memory in the background:
- Extracts entities (tools, projects, people, organizations, concepts)
- Generates summaries (first-sentence snippets)
- Creates temporal links (PRECEDED_BY to recent memories)
- Detects emerging patterns and strengthens Pattern nodes
- Finds semantic neighbors via Qdrant (creates SIMILAR_TO relationships)
- All enrichment is asynchronous and doesn't block storage

CONSOLIDATION AWARENESS:
AutoMem automatically:
- Decays importance over time (5 min intervals)
  → Counter: Boost importance when accessing critical memories
- Discovers creative associations (hourly)
  → Leverage: Check for new connections in next session
- Clusters similar memories (6 hours)
  → Prepare: Tag consistently for better clustering
- Archives low-importance memories (daily)
  → Plan: Let temporary debug info decay naturally

Work WITH consolidation timing:
- Store high-importance (0.8+) for critical knowledge → survives all consolidation
- Use medium importance (0.5-0.7) for patterns → survives 1-2 days
- Let low importance (<0.3) naturally decay → gone within hours
- Update rather than duplicate when possible → prevents cluster confusion
- Time-sensitive memories: Add time_query constraints in recalls

MEMORY HEALTH MONITORING:
Periodic checks (run these occasionally):
- Check for orphaned memories (no relationships, old, low importance)
- Identify contradiction clusters that need resolution
- Find high-importance memories without relationships (add connections)
- Look for duplicate content patterns (consolidate manually)

EXAMPLE ENHANCED MEMORY:
```
mcp__memory__store_memory({
  content: "Implemented React hook for AutoJack Chat memory display with purple gradient theme",
  tags: ["autojack-chat", "react", "ui", "implementation"],
  importance: 0.8,
  type: "Pattern"
})

# Then create relationship
mcp__memory__associate_memories({
  memory1_id: "prev_memory_id",
  memory2_id: "new_memory_id",
  type: "EVOLVED_INTO",
  strength: 0.9
})
```

NEVER STORE:
- Temporary file contents
- Debug output without analysis
- Sensitive credentials or keys
- Large code blocks (store patterns instead)
- Duplicate memories (check first with recall)
</memory_rules>
```

## Additional Resources

- **[Claude Code Integration Guide](CLAUDE_CODE_INTEGRATION.md)** - Complete guide to hooks, queue system, and expected behavior
- **[AutoMem Documentation](https://github.com/verygoodplugins/automem)** - Core service documentation
- **[MCP AutoMem Server](https://github.com/verygoodplugins/mcp-automem)** - MCP bridge repository
