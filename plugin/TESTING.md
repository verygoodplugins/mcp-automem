# Testing the AutoMem Plugin

Guide for testing the AutoMem plugin locally before distribution.

## Quick Test Setup

### 1. Start from Repository Root

```bash
cd /path/to/mcp-automem
```

### 2. Start Claude Code

```bash
claude
```

### 3. Add Local Marketplace

```shell
/plugin marketplace add ./plugin
```

You should see:
```
✓ Added marketplace: local
```

### 4. Install Plugin

```shell
/plugin install mcp-automem@local
```

Select "Install now" when prompted. Claude Code will restart.

### 5. Verify Installation

After restart:

```shell
# Check plugin is installed
/plugin

# View new commands
/help
```

Expected output:
- `/automem-status` - Check AutoMem system status
- `/automem-recall` - Recall relevant memories
- `/automem-queue` - Process memory queue
- Memory Assistant in `/agents` list

## Test Checklist

### ✅ Plugin Metadata

```shell
/plugin
```

Verify:
- [x] Plugin name: "mcp-automem"
- [x] Description appears correctly
- [x] Version: 1.0.0
- [x] Author: Very Good Plugins
- [x] Commands are listed (3)
- [x] Agents are listed (1)
- [x] Hooks are listed (PostToolUse, Stop)

### ✅ Commands Work

#### Test `/automem-status`

```shell
/automem-status
```

Expected: Shows system health, recent activity, queue status

#### Test `/automem-recall`

```shell
/automem-recall
```

Expected: Performs context-aware memory recall

#### Test `/automem-queue`

```shell
/automem-queue
```

Expected: Reports queue status and processes if needed

### ✅ Agent Works

```shell
/agents
```

Select "memory-assistant" and test:
- Ask: "What do you remember about this project?"
- Ask: "Store this decision: Using PostgreSQL for better ACID guarantees"
- Ask: "Show me recent memories from the last week"

Expected: Agent responds appropriately using memory tools

### ✅ Hooks Trigger

#### Test Git Commit Hook

```bash
# In terminal
cd /tmp
mkdir test-project
cd test-project
git init
echo "test" > test.txt
git add .
git commit -m "Test commit"
```

Expected:
- Hook triggers after commit
- Check queue: `cat ~/.claude/scripts/memory-queue.jsonl`
- Should have an entry about the commit

#### Test Build Hook

```bash
# In Claude Code
/run npm run build
# or any command with "build" in it
```

Expected:
- Hook captures build result
- Adds to queue

#### Test Session End Hook

```shell
# Exit Claude Code
exit
```

Expected:
- Smart notification appears
- Session memory captured
- Queue processed (entries sent to AutoMem)
- Queue file cleaned/cleared

### ✅ File Permissions

```bash
# Check hook scripts are executable
ls -la ~/.claude/plugins/mcp-automem@local/hooks/*.sh

# Should show: -rwxr-xr-x
```

If not executable:
```bash
chmod +x ~/.claude/plugins/mcp-automem@local/hooks/*.sh
chmod +x ~/.claude/plugins/mcp-automem@local/scripts/*.sh
```

### ✅ MCP Server Connection

```shell
/automem-status
```

Expected:
- Shows "System Health: ✓ Connected"
- Or shows clear error message if service not running

If service not running:
```bash
# Start AutoMem service
docker run -p 5050:5050 verygoodplugins/automem

# Or use railway/cloud deployment
# Update .claude-plugin/.mcp.json with your URL
```

### ✅ Logs

Check logs are being created:

```bash
# Session memory log
tail -f ~/.claude/logs/session-memory.log

# Queue cleanup log
tail -f ~/.claude/logs/queue-cleanup.log
```

Expected: Logs show hook activity with timestamps

## Test Different Configurations

### Minimal Setup (Default)

Already tested above - only git commits and builds captured.

### Full Setup (All Hooks)

1. Copy extras config:
```bash
cd ~/.claude/plugins/mcp-automem@local/hooks/
cp hooks.extras.json hooks.json
```

2. Restart Claude Code

3. Test additional hooks:
   - **Code Edit**: Make an edit with `/edit` command
   - **Test Run**: Run a test command (`npm test`)
   - **Deployment**: Run a deploy command (`npm run deploy`)
   - **Web Search**: Use web search tool
   - **Error Resolution**: Trigger error pattern

4. Check queue after each:
```bash
cat ~/.claude/scripts/memory-queue.jsonl | jq .
```

### Custom Filters

1. Edit filters:
```bash
cd ~/.claude/plugins/mcp-automem@local/scripts/
nano memory-filters.json
```

2. Add a custom trivial pattern:
```json
{
  "trivial_patterns": [
    ".DS_Store",
    "test-ignore-this.txt"
  ]
}
```

3. Test that changes matching pattern are ignored:
```bash
touch test-ignore-this.txt
git add .
git commit -m "Should be filtered"
```

4. Check queue - should not include test-ignore-this.txt

## Test Update Scenarios

### Update Plugin

1. Make changes to plugin files
2. Uninstall:
```shell
/plugin uninstall mcp-automem@local
```

3. Reinstall:
```shell
/plugin install mcp-automem@local
```

4. Verify changes took effect

### Update MCP Config

1. Edit `.claude-plugin/.mcp.json`
2. Change `AUTOMEM_API_URL`
3. Restart Claude Code
4. Run `/automem-status` to verify new URL

## Test Edge Cases

### Empty Queue

```bash
rm ~/.claude/scripts/memory-queue.jsonl
```

```shell
/automem-queue
```

Expected: Reports queue is empty, no errors

### Large Queue

```bash
# Add 100 test entries to queue
for i in {1..100}; do
  echo "{\"content\":\"Test $i\",\"tags\":[\"test\"],\"importance\":0.5,\"timestamp\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}" >> ~/.claude/scripts/memory-queue.jsonl
done
```

```shell
/automem-queue
```

Expected: Processes all entries, may show progress

### Service Unreachable

1. Stop AutoMem service:
```bash
docker stop <container-id>
```

2. Test commands:
```shell
/automem-status
/automem-recall
```

Expected: Clear error messages, helpful suggestions

3. Restart service:
```bash
docker start <container-id>
```

4. Verify recovery:
```shell
/automem-status
```

## Test Cleanup

After testing, clean up if desired:

```bash
# Remove test queue entries
rm ~/.claude/scripts/memory-queue.jsonl

# Remove test logs
rm ~/.claude/logs/session-memory.log
rm ~/.claude/logs/queue-cleanup.log

# Uninstall plugin
```

```shell
/plugin uninstall mcp-automem@local
```

```bash
# Remove marketplace
```

```shell
/plugin marketplace remove local
```

## Performance Testing

### Memory Usage

```bash
# Monitor Claude Code memory usage during plugin operation
ps aux | grep claude
```

### Hook Latency

Add timing to hooks:

```bash
time bash ~/.claude/plugins/mcp-automem@local/hooks/session-memory.sh
```

Expected: < 1 second for most hooks

### Queue Processing Speed

```bash
# Time queue processing
time npx @verygoodplugins/mcp-automem queue --file ~/.claude/scripts/memory-queue.jsonl
```

Expected: ~1-2 seconds per 10 memories

## Troubleshooting Tests

### Hooks Not Triggering

1. Check hook registration:
```shell
/plugin
# View mcp-automem details
```

2. Test hook manually:
```bash
CLAUDE_HOOK_TYPE=test bash ~/.claude/plugins/mcp-automem@local/hooks/session-memory.sh
```

3. Check logs:
```bash
tail -f ~/.claude/logs/session-memory.log
```

### Commands Not Appearing

1. Verify plugin installed:
```shell
/plugin
```

2. Check command files exist:
```bash
ls ~/.claude/plugins/mcp-automem@local/commands/
```

3. Restart Claude Code

### Agent Not Found

1. Check agent file exists:
```bash
cat ~/.claude/plugins/mcp-automem@local/agents/memory-assistant.md
```

2. Verify in agent list:
```shell
/agents
```

## Success Criteria

Plugin is ready for distribution when:

- ✅ All commands work without errors
- ✅ Agent loads and uses memory tools correctly
- ✅ Hooks trigger on appropriate events
- ✅ Queue processes successfully
- ✅ Logs show expected activity
- ✅ No permission errors
- ✅ MCP server connection works
- ✅ Clean uninstall/reinstall cycle
- ✅ Documentation is accurate
- ✅ No console errors or warnings

## Report Issues

When reporting test failures, include:

1. Steps to reproduce
2. Expected behavior
3. Actual behavior
4. Relevant logs from `~/.claude/logs/`
5. Claude Code version
6. Plugin version
7. OS and environment details

Submit issues to: https://github.com/verygoodplugins/mcp-automem/issues

