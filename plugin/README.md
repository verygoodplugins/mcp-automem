# Very Good Plugins Marketplace

Official marketplace for Very Good Plugins' Claude Code plugins.

## Plugins

### mcp-automem

Persistent memory system for Claude Code with automatic capture, intelligent recall, and knowledge graph building.

**Features:**
- 🧠 Automatic memory capture from git commits, builds, and more
- 🔍 Intelligent semantic recall with hybrid search
- 🕸️ Knowledge graph with 11 relationship types
- 🎯 Smart filtering and deduplication
- 📊 Session context loading
- 🔗 Cross-platform sync

**Installation:**
```shell
/plugin marketplace add verygoodplugins/claude-plugins
/plugin install mcp-automem@verygoodplugins
```

## Local Development

To test this marketplace locally:

```shell
# Add local marketplace
/plugin marketplace add /path/to/this/directory

# Install plugin
/plugin install mcp-automem@local
```

## Plugin Development

To create a new plugin for this marketplace:

1. Create a new directory in this marketplace root
2. Add `.claude-plugin/plugin.json` with plugin metadata
3. Add your plugin components (commands, agents, hooks, scripts)
4. Update `marketplace.json` to include your plugin
5. Test locally before publishing

See the [mcp-automem](./mcp-automem/) directory for a complete example.

## Publishing

### Option 1: GitHub Repository (Recommended)

```shell
# Users add your marketplace via GitHub
/plugin marketplace add username/repo-name
```

Your repository structure:
```
repo-name/
├── .claude-plugin/
│   └── marketplace.json
└── plugin-name/
    ├── .claude-plugin/
    │   └── plugin.json
    └── ... plugin files ...
```

### Option 2: Git Repository URL

```shell
# Users add via full Git URL
/plugin marketplace add https://github.com/username/repo-name.git
```

### Option 3: Local Development

```shell
# For testing and development
/plugin marketplace add /local/path/to/marketplace
```

## Marketplace Structure

```
verygoodplugins/
├── .claude-plugin/
│   └── marketplace.json      # Marketplace manifest
├── mcp-automem/               # Plugin directory
│   ├── .claude-plugin/
│   │   ├── plugin.json       # Plugin manifest
│   │   └── .mcp.json         # MCP server config
│   ├── commands/              # Slash commands
│   ├── agents/                # Specialized agents
│   ├── hooks/                 # Hook scripts
│   ├── scripts/               # Support scripts
│   └── README.md
└── README.md                  # This file
```

## Plugin Guidelines

### Naming
- Use lowercase with hyphens (e.g., `my-plugin`)
- Keep names short and descriptive
- Prefix with purpose or organization if needed

### Versioning
- Use semantic versioning (MAJOR.MINOR.PATCH)
- Document breaking changes
- Update version in both plugin.json and marketplace.json

### Documentation
- Include a comprehensive README.md in your plugin directory
- Document all commands, agents, and hooks
- Provide troubleshooting guidance
- Include usage examples

### Testing
- Test locally before publishing
- Verify all hooks trigger correctly
- Check that all scripts are executable
- Test on a clean Claude Code installation

## Support

- **GitHub**: [verygoodplugins/mcp-automem](https://github.com/verygoodplugins/mcp-automem)
- **Issues**: [GitHub Issues](https://github.com/verygoodplugins/mcp-automem/issues)
- **Email**: support@verygoodplugins.com

## License

See individual plugin directories for license information.

