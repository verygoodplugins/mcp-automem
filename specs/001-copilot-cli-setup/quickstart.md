# Quickstart: Copilot CLI Setup Command

**Feature**: 001-copilot-cli-setup | **Date**: 2025-07-24

## Prerequisites

- Node.js (^20.19.0 || ^22.13.0 || >=24)
- npm
- `@verygoodplugins/mcp-automem` installed (globally or via npx)
- AutoMem service running (local or remote) with `AUTOMEM_API_URL` configured

## Developer Setup (working on this feature)

```bash
# Clone and install
git clone https://github.com/verygoodplugins/mcp-automem.git
cd mcp-automem
npm install

# Switch to feature branch
git checkout 001-add-copilot-hooks

# Build
npm run build

# Run tests
npm test

# Type check
npm run typecheck

# Lint
npm run lint
```

## Testing the Feature

### Preview without changes (dry-run)

```bash
# See what would be installed
npx @verygoodplugins/mcp-automem copilot --dry-run

# Preview with VS Code format
npx @verygoodplugins/mcp-automem copilot --format vscode --dry-run

# Preview to custom directory
npx @verygoodplugins/mcp-automem copilot --dir /tmp/test-copilot --dry-run
```

### Install to a test directory

```bash
# Install to temp directory (avoids touching real ~/.copilot)
npx @verygoodplugins/mcp-automem copilot --dir /tmp/test-copilot --yes

# Verify hook JSON files
cat /tmp/test-copilot/hooks/automem-session-start.json
cat /tmp/test-copilot/hooks/automem-post-tool-use.json
cat /tmp/test-copilot/hooks/automem-session-end.json

# Verify scripts
ls -la /tmp/test-copilot/scripts/
```

### Install for real use

```bash
# Install with default settings (CLI format, ~/.copilot)
npx @verygoodplugins/mcp-automem copilot --yes

# Install with VS Code format
npx @verygoodplugins/mcp-automem copilot --format vscode --yes
```

### Verify installation

```bash
# Check hook files exist and are valid JSON
jq . ~/.copilot/hooks/automem-session-start.json
jq . ~/.copilot/hooks/automem-post-tool-use.json
jq . ~/.copilot/hooks/automem-session-end.json

# Check scripts are executable
ls -la ~/.copilot/scripts/*.sh

# Check memory rules template exists in package
cat node_modules/@verygoodplugins/mcp-automem/templates/COPILOT_INSTRUCTIONS_MEMORY_RULES.md
```

### Re-install (backup test)

```bash
# Run installer again - should create .bak files
npx @verygoodplugins/mcp-automem copilot --yes

# Verify backups exist
ls ~/.copilot/hooks/*.bak
```

## Key Files to Modify

| File | Purpose |
|---|---|
| `src/cli/copilot.ts` | New CLI command handler |
| `src/index.ts` | Register `copilot` command in routing |
| `templates/copilot/hooks/*.json` | Hook JSON templates |
| `templates/copilot/scripts/*` | Adapted support scripts |
| `templates/COPILOT_INSTRUCTIONS_MEMORY_RULES.md` | Memory rules template |
| `tests/copilot-setup.test.ts` | Unit tests |

## Build & Test Cycle

```bash
# Edit TypeScript in src/cli/copilot.ts
npm run build          # Must succeed
npm test               # Must pass
npm run typecheck      # Must pass
npm run lint           # Must pass

# Test manually
node dist/index.js copilot --dry-run
```
