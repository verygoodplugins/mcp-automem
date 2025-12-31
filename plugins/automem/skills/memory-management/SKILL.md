---
name: memory-management
description: |
  Persistent memory management for Claude Code via AutoMem. Use this skill when:
  - Starting a session (recall project context, decisions, patterns)
  - Making architectural decisions or library choices
  - Fixing bugs (store root cause and solution)
  - Learning user preferences or code style
  - Completing significant work (store summary)
  - Debugging issues (search for similar past problems)
allowed-tools:
  - mcp__memory__store_memory
  - mcp__memory__recall_memory
  - mcp__memory__associate_memories
  - mcp__memory__update_memory
  - mcp__memory__delete_memory
  - mcp__memory__check_database_health
---

# Memory Management Skill

Use AutoMem to maintain persistent context across Claude Code sessions. This skill teaches the **3-Phase Memory Pattern**: Recall → Store → Summarize.

## Phase 1: SESSION START (Recall)

### Always Recall For

- Project context questions (architecture, tooling, deployment)
- Architecture discussions or decisions
- User preferences and code style
- Debugging issues (search for similar past problems)
- Refactoring (understand why current structure exists)
- Integration or API work (check past implementations)
- Performance optimization discussions

### Adaptive Recall Based on Context

- **Files open** → Recall memories tagged with those components
- **Error messages** → Search for similar error patterns
- **Multiple files** → Recall architectural decisions
- **PR/commit context** → Recall related feature implementations

### Skip Recall For

- Pure syntax questions ("How does Array.map work?")
- Trivial edits (typos, formatting, simple renames)
- Direct factual queries about current code
- File content requests that can be answered by reading

### Recall Examples

```javascript
// Basic project recall
mcp__memory__recall_memory({
  query: "project architecture decisions",
  tags: ["project-name"],
  limit: 5
})

// Debug similar errors
mcp__memory__recall_memory({
  query: "TypeError authentication timeout",
  tags: ["bug-fix"],
  time_query: "last 30 days",
  limit: 5
})

// Multi-hop reasoning (find related context)
mcp__memory__recall_memory({
  query: "Who worked on the auth system?",
  expand_entities: true,
  limit: 10
})

// Context-aware coding recall
mcp__memory__recall_memory({
  query: "error handling patterns",
  language: "typescript",
  context: "coding-style",
  context_types: ["Style", "Pattern"]
})
```

## Phase 2: DURING WORK (Store)

### What to Store with Importance Levels

| Type | Importance | When to Store |
|------|------------|---------------|
| **Decision** | 0.9 | Architecture, library choices, pattern decisions |
| **Insight** | 0.8 | Root cause discoveries, key learnings, bug fixes |
| **Pattern** | 0.7 | Reusable approaches, best practices |
| **Preference** | 0.6-0.8 | User config choices, style preferences |
| **Context** | 0.5-0.7 | Feature summaries, refactoring notes |

### Storage Format

```text
Content: "Brief title. Context and details. Impact/outcome."
Tags: [project-name, component, YYYY-MM, type]
Type: Decision | Pattern | Insight | Preference | Style | Habit | Context
```

### Storage Examples

**Decision:**
```javascript
mcp__memory__store_memory({
  content: "Chose PostgreSQL over MongoDB. Need ACID guarantees for transactions. Impact: Ensures data consistency.",
  type: "Decision",
  tags: ["myapp", "database", "decision", "2025-12"],
  importance: 0.9,
  metadata: {
    alternatives_considered: ["MongoDB", "DynamoDB"],
    deciding_factors: ["ACID", "relationships", "team_expertise"]
  }
})
```

**Bug Fix:**
```javascript
mcp__memory__store_memory({
  content: "Auth timeout on slow connections. Root: Missing retry logic. Solution: Added exponential backoff with 3 retries.",
  type: "Insight",
  tags: ["myapp", "auth", "bug-fix", "2025-12"],
  importance: 0.8,
  metadata: {
    error_signature: "TimeoutError: Authentication request timed out",
    solution_pattern: "exponential-backoff-retry",
    files_modified: ["src/auth/client.ts"]
  }
})
```

**User Preference:**
```javascript
mcp__memory__store_memory({
  content: "User prefers early returns over nested conditionals in validation code.",
  type: "Preference",
  tags: ["preferences", "code-style", "2025-12"],
  importance: 0.8
})
```

### After Storing: Create Associations

Link related memories to build a knowledge graph:

```javascript
mcp__memory__associate_memories({
  memory1_id: "new-memory-id",
  memory2_id: "related-memory-id",
  type: "DERIVED_FROM",  // or LEADS_TO, EVOLVED_INTO, RELATES_TO
  strength: 0.9
})
```

**Relationship Types:**
- `LEADS_TO` - Bug → Solution, Problem → Fix
- `EVOLVED_INTO` - Updated approaches or decisions
- `DERIVED_FROM` - Implementation from planning
- `EXEMPLIFIES` - Concrete examples of patterns
- `CONTRADICTS` - Conflicting approaches
- `REINFORCES` - Supporting evidence
- `INVALIDATED_BY` - Obsoleted solutions
- `RELATES_TO` - General connections

## Phase 3: SESSION END (Summarize)

Store a session summary when:
- Multiple files modified
- Significant refactoring completed
- New features implemented
- Important decisions made

```javascript
mcp__memory__store_memory({
  content: "Added authentication system with JWT. Supports login, logout, and token refresh. Impact: Users can now login securely.",
  type: "Context",
  tags: ["myapp", "auth", "feature", "2025-12"],
  importance: 0.9,
  metadata: {
    files_modified: ["src/auth/UserAuth.ts", "src/middleware/auth.ts"],
    feature: "authentication"
  }
})
```

## Best Practices

### Do

- Load context automatically at session start
- Store high-signal events (decisions, bugs, patterns)
- Create specific relationship types (not just RELATES_TO)
- Include rich metadata in every memory
- Present recalled information naturally
- Tag consistently: project, component, type, YYYY-MM

### Don't

- Store secrets, API keys, or sensitive data
- Store trivial changes (typos, formatting)
- Create associations without verifying relevance
- Skip tagging or use inconsistent formats
- Announce "I'm searching my memory" constantly
- Store large code blocks (store patterns/decisions instead)

## Natural Integration

When recalling memories, weave context seamlessly into responses. Avoid robotic phrases like "searching my memory database" - present memories as if you've always known them.

**Bad:** "Let me search my memory... I found that you previously decided to use PostgreSQL."

**Good:** "Since you chose PostgreSQL for its ACID guarantees, we should use transactions here."
