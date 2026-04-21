# Memory Storage Patterns

Quick reference for common memory storage patterns.

## Decision Pattern

When architecture, library, or approach decisions are made:

```javascript
mcp__memory__store_memory({
  content: "[CHOICE] over [ALTERNATIVES]. [REASON]. Impact: [OUTCOME].",
  type: "Decision",
  importance: 0.9,
  confidence: 0.9,
  tags: ["decision", "project", "component"],
  metadata: {
    alternatives_considered: ["alt1", "alt2"],
    deciding_factors: ["factor1", "factor2"]
  }
})
```

## Bug Fix Pattern

When root causes are discovered and fixed:

```javascript
mcp__memory__store_memory({
  content: "[SYMPTOM]. Root: [CAUSE]. Solution: [FIX].",
  type: "Insight",
  importance: 0.8,
  confidence: 0.85,
  tags: ["bugfix", "solution", "project", "component"],
  metadata: {
    error_signature: "exact error message",
    solution_pattern: "pattern-name",
    files_modified: ["path/to/file.ts"]
  }
})
```

## User Preference Pattern

When learning user preferences or style:

```javascript
mcp__memory__store_memory({
  content: "User prefers [PREFERENCE] in [CONTEXT].",
  type: "Preference",
  importance: 0.8,
  confidence: 0.95,
  tags: ["preference", "domain"]
})
```

## Code Pattern

When discovering reusable patterns:

```javascript
mcp__memory__store_memory({
  content: "Using [PATTERN]. [BENEFIT]. Applied in [SCOPE].",
  type: "Pattern",
  importance: 0.7,
  confidence: 0.8,
  tags: ["pattern", "project", "domain"],
  metadata: {
    pattern: "pattern-name",
    applied_in: ["path/to/*.ts"]
  }
})
```

## Feature Summary Pattern

When a durable feature-level memory is genuinely worth keeping:

```javascript
mcp__memory__store_memory({
  content: "Added [FEATURE]. [CAPABILITIES]. Impact: [VALUE].",
  type: "Context",
  importance: 0.8,
  confidence: 0.8,
  tags: ["feature", "project", "component"],
  metadata: {
    files_modified: ["file1.ts", "file2.ts"],
    feature: "feature-name"
  }
})
```

## Tagging Convention

Always prefer:
1. **Category** - `decision`, `bugfix`, `solution`, `pattern`, `feature`
2. **Project slug** - only when the memory is clearly project-scoped
3. **Component / domain** - auth, api, frontend, deployment
4. **Language or domain** - only if it improves recall

Use bare tags only. Do not use platform tags or date tags.

## Importance Scoring

| Score | When to Use |
|-------|-------------|
| 0.9-1.0 | Critical decisions, major features, breaking changes |
| 0.7-0.8 | Important patterns, significant bugs, preferences |
| 0.5-0.7 | Helpful patterns, minor features, config changes |
| 0.3-0.5 | Small fixes, temporary workarounds, notes |
