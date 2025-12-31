# Memory Storage Patterns

Quick reference for common memory storage patterns.

## Decision Pattern

When architecture, library, or approach decisions are made:

```javascript
mcp__memory__store_memory({
  content: "[CHOICE] over [ALTERNATIVES]. [REASON]. Impact: [OUTCOME].",
  type: "Decision",
  importance: 0.9,
  tags: ["project", "component", "decision", "YYYY-MM"],
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
  tags: ["project", "component", "bug-fix", "YYYY-MM"],
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
  tags: ["preferences", "domain", "YYYY-MM"]
})
```

## Code Pattern

When discovering reusable patterns:

```javascript
mcp__memory__store_memory({
  content: "Using [PATTERN]. [BENEFIT]. Applied in [SCOPE].",
  type: "Pattern",
  importance: 0.7,
  tags: ["project", "pattern", "domain", "YYYY-MM"],
  metadata: {
    pattern: "pattern-name",
    applied_in: ["path/to/*.ts"]
  }
})
```

## Feature Summary Pattern

After completing significant work:

```javascript
mcp__memory__store_memory({
  content: "Added [FEATURE]. [CAPABILITIES]. Impact: [VALUE].",
  type: "Context",
  importance: 0.8,
  tags: ["project", "feature", "component", "YYYY-MM"],
  metadata: {
    files_modified: ["file1.ts", "file2.ts"],
    feature: "feature-name"
  }
})
```

## Tagging Convention

Always include:
1. **Project name** - Primary identifier
2. **Component** - Specific area (auth, api, frontend)
3. **Type** - decision, bug-fix, pattern, feature
4. **Date** - YYYY-MM format

## Importance Scoring

| Score | When to Use |
|-------|-------------|
| 0.9-1.0 | Critical decisions, major features, breaking changes |
| 0.7-0.8 | Important patterns, significant bugs, preferences |
| 0.5-0.7 | Helpful patterns, minor features, config changes |
| 0.3-0.5 | Small fixes, temporary workarounds, notes |
