# Quickstart: Verifying Copilot Parity Features

**Date**: 2025-07-25 | **Plan**: [plan.md](plan.md)

## Prerequisites

- Spec 001 (`001-copilot-cli-setup`) must be implemented and merged
- Node.js (^20.19.0 || ^22.13.0 || >=24)
- `npm run build` passes
- `npm test` passes

## 1. Profile Installation

### Verify lean profile (default)

```bash
npm run build
npx mcp-automem copilot --profile lean --dry-run
```

**Expected**: Only `automem-session-start.json` and `automem-session-end.json` listed.

### Verify extras profile

```bash
npx mcp-automem copilot --profile extras --dry-run
```

**Expected**: All 5 hook files listed (session-start, build, test, deploy, session-end).

### Verify profile switching

```bash
# Install extras first
npx mcp-automem copilot --profile extras --yes
ls ~/.copilot/hooks/automem-*.json  # Should show 5 files

# Switch to lean
npx mcp-automem copilot --profile lean --yes
ls ~/.copilot/hooks/automem-*.json  # Should show 2 files only
```

### Verify invalid profile error

```bash
npx mcp-automem copilot --profile invalid
```

**Expected**: Error message listing valid profiles (`lean`, `extras`), exit code 1.

## 2. PowerShell Scripts (Windows)

### Verify scripts installed

```powershell
ls ~/.copilot/scripts/*.ps1
```

**Expected**: `capture-build-result.ps1`, `capture-test-pattern.ps1`, `capture-deployment.ps1`, `session-memory.ps1`, `queue-cleanup.ps1`, `python-command.ps1`

### Verify hook JSON references PS scripts

```powershell
Get-Content ~/.copilot/hooks/automem-build.json | ConvertFrom-Json | Select-Object powershell
```

**Expected**: `powershell -ExecutionPolicy Bypass -File "$HOME/.copilot/scripts/capture-build-result.ps1"` (not a warning stub).

### Verify PS script silent failure

```powershell
# Feed invalid JSON to a capture script
echo "not json" | powershell -ExecutionPolicy Bypass -File ~/.copilot/scripts/capture-build-result.ps1
echo $LASTEXITCODE  # Should be 0
```

## 3. Uninstall

### Verify dry-run

```bash
npx mcp-automem uninstall copilot --dry-run
```

**Expected**: Lists all AutoMem files that would be removed.

### Verify actual uninstall

```bash
npx mcp-automem uninstall copilot --yes
ls ~/.copilot/hooks/automem-*.json 2>/dev/null  # Should find nothing
ls ~/.copilot/scripts/capture-*.sh 2>/dev/null   # Should find nothing
ls ~/.copilot/scripts/capture-*.ps1 2>/dev/null  # Should find nothing
```

### Verify clean-all

```bash
# Re-install first
npx mcp-automem copilot --yes
# Then uninstall with clean-all
npx mcp-automem uninstall copilot --clean-all --yes
```

**Expected**: Hook files, scripts, AND MCP server config entry removed.

## 4. Migrate

### Verify migrate to copilot

```bash
npx mcp-automem migrate --from none --to copilot --dry-run
```

**Expected**: Shows planned copilot hook installation.

### Verify migrate from copilot

```bash
npx mcp-automem migrate --from copilot --to claude-code --dry-run
```

**Expected**: Analyzes existing copilot hooks, shows planned claude-code installation.

## 5. Build and Test

```bash
npm run build    # Must pass
npm test         # Must pass
npm run lint     # Must pass
npm run typecheck  # Must pass
```

All four gates must pass before this feature can be merged.
