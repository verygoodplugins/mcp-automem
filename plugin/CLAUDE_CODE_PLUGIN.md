# AutoMem Claude Code Plugin

Complete implementation of AutoMem as a native Claude Code plugin.

## Overview

This directory contains the AutoMem plugin structured for Claude Code's native plugin system. The plugin provides persistent memory capabilities through automatic capture, intelligent recall, and knowledge graph building.

## Directory Structure

```
plugin/
├── .claude-plugin/
│   └── marketplace.json              # Marketplace manifest for distribution
├── mcp-automem/                       # Plugin directory
│   ├── .claude-plugin/
│   │   ├── plugin.json               # Plugin metadata and permissions
│   │   └── .mcp.json                 # MCP server configuration
│   ├── commands/                      # Slash commands
│   │   ├── automem-status.md         # System health check
│   │   ├── automem-recall.md         # Context-aware memory recall
│   │   └── automem-queue.md          # Manual queue processing
│   ├── agents/                        # Specialized agents
│   │   └── memory-assistant.md       # Memory management agent
│   ├── hooks/                         # Event hooks
│   │   ├── hooks.json                # Default hooks (minimal)
│   │   ├── hooks.extras.json         # All hooks (optional)
│   │   ├── session-memory.sh         # Session/commit capture
│   │   ├── capture-build-result.sh   # Build event capture
│   │   ├── capture-code-pattern.sh   # Code edit capture
│   │   ├── capture-deployment.sh     # Deployment capture
│   │   ├── capture-error-resolution.sh # Error fix capture
│   │   ├── capture-search-result.sh  # Web search capture
│   │   └── capture-test-pattern.sh   # Test execution capture
│   ├── scripts/                       # Support scripts
│   │   ├── memory-filters.json       # Capture filtering rules
│   │   ├── process-session-memory.py # Memory processing
│   │   ├── queue-cleanup.sh          # Queue deduplication
│   │   ├── semantic-recall.py        # Semantic search helper
│   │   └── smart-notify.sh           # Session notifications
│   └── README.md                      # Plugin documentation
├── README.md                          # Marketplace documentation
├── TESTING.md                         # Testing guide
└── CLAUDE_CODE_PLUGIN.md             # This file
```

## Key Components

### 1. Plugin Manifest (`plugin.json`)

Defines plugin metadata:
- Name, description, version
- Author and repository information
- Required permissions for MCP memory tools
- Keywords and license

### 2. MCP Configuration (`.mcp.json`)

Configures the AutoMem MCP server:
- Command: `npx @verygoodplugins/mcp-automem`
- Environment: `AUTOMEM_API_URL` (default: localhost:5050)

### 3. Commands (3 slash commands)

**`/automem-status`**
- Checks system health
- Reports recent activity
- Shows queue status

**`/automem-recall`**
- Performs intelligent memory recall
- Context-aware (project, files, intent)
- Parallel search strategies

**`/automem-queue`**
- Manually processes memory queue
- Reports results and errors
- Useful for testing and troubleshooting

### 4. Memory Assistant Agent

Specialized agent for:
- Storing memories with proper classification
- Creating relationships between memories
- Finding and consolidating duplicates
- Updating or deleting outdated information
- Proactive context loading

### 5. Hook System

**PostToolUse Hooks (2 default, 6 optional):**

Default:
- `Bash(git commit*)` → Session memory capture
- `Bash(*build*)` → Build result capture

Optional (enable via `hooks.extras.json`):
- `Edit(*)` / `MultiEdit(*)` → Code pattern capture
- `Bash(*test*)` → Test pattern capture
- `Bash(*deploy*)` → Deployment capture
- `WebSearch(*)` → Search result capture
- `Bash(*error*)` → Error resolution capture

**Stop Hooks (session end):**
- Smart notification
- Final session capture
- Queue cleanup (deduplication)
- Queue processing (send to AutoMem)

### 6. Support Scripts

**Python Scripts:**
- `process-session-memory.py` - Analyzes and scores memories
- `semantic-recall.py` - Enhanced semantic search with embeddings

**Bash Scripts:**
- `queue-cleanup.sh` - Deduplicates and manages queue overflow
- `smart-notify.sh` - Desktop notifications for session completion

**Configuration:**
- `memory-filters.json` - Filtering rules, file weights, significance keywords

## Installation Methods

### Method 1: Via GitHub Marketplace

```shell
/plugin marketplace add verygoodplugins/claude-plugins
/plugin install mcp-automem@verygoodplugins
```

### Method 2: Via Local Directory

```shell
/plugin marketplace add /path/to/this/directory
/plugin install mcp-automem@local
```

### Method 3: Via Git URL

```shell
/plugin marketplace add https://github.com/verygoodplugins/mcp-automem.git#plugin
/plugin install mcp-automem
```

## Configuration Options

### 1. Change AutoMem Service URL

Edit `mcp-automem/.claude-plugin/.mcp.json`:
```json
{
  "mcpServers": {
    "memory": {
      "env": {
        "AUTOMEM_API_URL": "https://your-instance.railway.app"
      }
    }
  }
}
```

### 2. Enable All Capture Hooks

```bash
cd ~/.claude/plugins/mcp-automem@marketplace/hooks/
cp hooks.extras.json hooks.json
# Restart Claude Code
```

### 3. Customize Filters

Edit `scripts/memory-filters.json`:
- Add/remove trivial patterns (files to ignore)
- Adjust file weight multipliers (importance by file type)
- Modify significance keywords (boost importance scores)

### 4. Adjust Capture Threshold

Edit `scripts/process-session-memory.py`:
```python
significance_threshold = 8  # Lower = more captures, higher = fewer
```

## Testing

See [TESTING.md](TESTING.md) for comprehensive testing guide.

Quick test:
```shell
# Install locally
/plugin marketplace add ./plugin
/plugin install mcp-automem@local

# Verify
/automem-status

# Test capture
git commit --allow-empty -m "Test"

# Check queue
cat ~/.claude/scripts/memory-queue.jsonl
```

## Differences from NPX Installation

### Plugin Advantages

✅ **Native integration** - Registered automatically with Claude Code
✅ **Easy discovery** - Browse in `/plugin` menu
✅ **Automatic updates** - Plugin system manages versions
✅ **Self-contained** - All paths relative to `{{PLUGIN_DIR}}`
✅ **Better management** - Enable/disable without editing configs

### Migration from NPX

If you used `npx @verygoodplugins/mcp-automem claude-code`:

1. **Keep existing queue and logs** - Plugin will use them
2. **Install plugin** - Hooks will override NPX hooks
3. **Optional cleanup** - Remove old NPX hook scripts from `~/.claude/hooks/`
4. **No breaking changes** - Both can coexist if needed

See [PLUGIN_INSTALLATION.md](../PLUGIN_INSTALLATION.md) for detailed migration guide.

## Distribution

### Publishing to GitHub

1. Create repository: `username/claude-plugins`
2. Copy this entire `plugin/` directory to repository root
3. Push to GitHub
4. Users install via:
   ```shell
   /plugin marketplace add username/claude-plugins
   /plugin install mcp-automem@username
   ```

### Publishing to Git Server

Works with any Git server (GitHub, GitLab, Gitea, etc.):
```shell
/plugin marketplace add https://git.example.com/org/repo.git#plugin
```

### Local Distribution

For teams or private use:
```shell
/plugin marketplace add /path/to/shared/plugin/directory
```

## Versioning

When releasing updates:

1. **Update version** in `plugin.json`:
   ```json
   {
     "version": "1.1.0"
   }
   ```

2. **Update marketplace.json** to match

3. **Document changes** in CHANGELOG.md

4. **Test thoroughly** - Use [TESTING.md](TESTING.md) checklist

5. **Tag release** in Git:
   ```bash
   git tag -a v1.1.0 -m "Release 1.1.0"
   git push --tags
   ```

## Maintenance

### Regular Updates

- Keep MCP dependencies current
- Update hook scripts for new Claude Code features
- Refine filters based on user feedback
- Improve agent prompts and behaviors

### Monitoring

Users can check:
- Logs at `~/.claude/logs/session-memory.log`
- Queue at `~/.claude/scripts/memory-queue.jsonl`
- System health via `/automem-status`

### Support

- Issues: https://github.com/verygoodplugins/mcp-automem/issues
- Email: support@verygoodplugins.com
- Docs: https://github.com/verygoodplugins/mcp-automem

## Development

### Adding New Commands

1. Create `commands/new-command.md`
2. Add frontmatter with description
3. Write command instructions
4. Test in Claude Code

### Adding New Hooks

1. Add hook matcher to `hooks/hooks.json` or `hooks.extras.json`
2. Create hook script in `hooks/`
3. Make script executable: `chmod +x hooks/script.sh`
4. Test hook triggering

### Updating Agent

1. Edit `agents/memory-assistant.md`
2. Modify instructions, examples, or capabilities
3. Reinstall plugin to test changes

### Modifying Filters

1. Edit `scripts/memory-filters.json`
2. Test with various file types and patterns
3. Adjust thresholds based on results

## Future Enhancements

Potential additions:
- Additional slash commands for memory management
- More specialized agents (architect, debugger, etc.)
- Enhanced filtering with ML-based significance scoring
- Integration with other MCP servers
- Team memory sharing capabilities
- Analytics dashboard

## License

MIT License - See [LICENSE](../LICENSE)

## Related Files

- [PLUGIN_INSTALLATION.md](../PLUGIN_INSTALLATION.md) - User installation guide
- [CLAUDE_CODE_INTEGRATION.md](../templates/CLAUDE_CODE_INTEGRATION.md) - Technical integration details
- [INSTALLATION.md](../INSTALLATION.md) - NPX installation (alternative method)
- [README.md](../README.md) - Main project README

