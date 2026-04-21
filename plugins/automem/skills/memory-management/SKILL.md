---
name: memory-management
description: |
  Persistent memory management for Claude Code via AutoMem. Use this skill when:
  - Starting a session (recall project context, decisions, patterns)
  - Making architectural decisions or library choices
  - Fixing bugs (store root cause and solution)
  - Learning user preferences or code style
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

Use AutoMem to maintain persistent context across Claude Code sessions.

> Deprecated compatibility note: this plugin skill is kept only for one release while users migrate to `npx @verygoodplugins/mcp-automem claude-code`. It should mirror the canonical Claude Code templates.

This skill teaches the current AutoMem playbook: **Recall early, store durable outcomes, avoid session-summary noise.**

## Phase 1: Session Start (Recall)

### Always Recall For

- Project context questions (architecture, tooling, deployment)
- Architecture discussions or decisions
- User preferences and code style
- Debugging issues (search for similar past problems)
- Refactoring (understand why current structure exists)
- Integration or API work (check past implementations)
- Performance optimization discussions

### Standard Recall Pattern

- **Preferences first**: recall with `tags: ["preference"]`, `limit: 20`, `sort: "updated_desc"`, `format: "detailed"`
- **Task context second**: one semantic query built from actual nouns in the request, optional project slug if unambiguous
- **Debugging third**: a tighter recall on the error text with `tags: ["bugfix", "solution"]`

### Skip Recall For

- Pure syntax questions ("How does Array.map work?")
- Trivial edits (typos, formatting, simple renames)
- Direct factual queries about current code
- File content requests that can be answered by reading

### Recall Examples

```javascript
// Preferences first
mcp__memory__recall_memory({
  tags: ["preference"],
  limit: 20,
  sort: "updated_desc",
  format: "detailed"
})

// Task context recall
mcp__memory__recall_memory({
  query: "authentication timeout PostgreSQL auth.ts retry logic",
  tags: ["myapp"],   // drop if ambiguous
  time_query: "last 90 days",
  limit: 30,
  format: "detailed"
})

// Debug similar errors
mcp__memory__recall_memory({
  query: "TimeoutError authentication request timed out",
  tags: ["bugfix", "solution"],
  limit: 20
})
```

## Phase 2: During Work (Store)

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
Tags: [category, project-slug, language]
Type: Decision | Pattern | Insight | Preference | Style | Habit | Context
```

Use bare tags only. Do not add platform tags or date tags.

### Storage Examples

**Decision:**
```javascript
mcp__memory__store_memory({
  content: "Chose PostgreSQL over MongoDB. Need ACID guarantees for transactions. Impact: Ensures data consistency.",
  type: "Decision",
  tags: ["decision", "myapp", "database"],
  importance: 0.9,
  confidence: 0.9,
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
  tags: ["bugfix", "solution", "myapp", "auth"],
  importance: 0.8,
  confidence: 0.85,
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
  tags: ["preference", "code-style"],
  importance: 0.8,
  confidence: 0.95
})
```

### After Storing: Create Associations

Link related memories to build a knowledge graph:

```javascript
mcp__memory__associate_memories({
  memory1_id: "related-memory-id",
  memory2_id: "new-memory-id",
  type: "INVALIDATED_BY",  // or PREFERS_OVER, LEADS_TO, EXEMPLIFIES
  strength: 0.9
})
```

Prefer `update_memory` over near-duplicate stores when a fact changed in place.

## Best Practices

### Do

- Load context automatically at session start
- Store high-signal events (decisions, bugs, patterns)
- Create specific relationship types when the link is explicit
- Include rich metadata in memories
- Present recalled information naturally
- Tag consistently with bare tags only

### Don't

- Store secrets, API keys, or sensitive data
- Store trivial changes (typos, formatting)
- Create associations without verifying relevance
- Use platform tags or date tags
- Announce "I'm searching my memory" constantly
- Store large code blocks (store patterns/decisions instead)
- Store end-of-session summaries by default

## Natural Integration

When recalling memories, weave context seamlessly into responses. Avoid robotic phrases like "searching my memory database" and present memories as normal working context.
