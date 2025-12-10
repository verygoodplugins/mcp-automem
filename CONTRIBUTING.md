# Contributing to MCP AutoMem

Thank you for your interest in contributing! This guide will help you get started.

## Development Setup

```bash
# Clone the repository
git clone https://github.com/verygoodplugins/mcp-automem.git
cd mcp-automem

# Install dependencies (sets up git hooks automatically)
npm install

# Build
npm run build

# Run tests
npm test

# Development with hot-reload
npm run dev
```

## Commit Message Format

We use [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/) for all commit messages. This enables automated versioning and changelog generation.

### Format

```
<type>[optional scope]: <description>

[optional body]

[optional footer(s)]
```

### Types

- **feat**: New feature (triggers minor version bump)
- **fix**: Bug fix (triggers patch version bump)
- **docs**: Documentation changes only
- **style**: Code style changes (formatting, etc.)
- **refactor**: Code refactoring without feature changes
- **perf**: Performance improvements
- **test**: Adding or updating tests
- **build**: Build system changes
- **ci**: CI configuration changes
- **chore**: Other changes (no release triggered)

### Examples

```bash
# Using commitizen (interactive prompt)
npm run commit

# Or manually
git commit -m "feat: add support for batch memory operations"
git commit -m "fix: correct outputSchema validation in associate_memories"
git commit -m "docs: update API reference"
git commit -m "feat!: remove deprecated search_by_tag tool"
```

### Breaking Changes

Add `!` after type or include `BREAKING CHANGE:` footer for major version bumps:

```bash
git commit -m "feat!: change recall_memory API signature"

# Or with footer
git commit -m "feat: update MCP SDK to v2

BREAKING CHANGE: Requires MCP SDK v2.0 or higher"
```

## Enforcement

### Local Validation (Git Hooks)

Husky + commitlint validates your commit messages:

```bash
# This will be rejected
git commit -m "updated stuff"
# Error: Subject may not be empty, type may not be empty

# This will pass
git commit -m "fix: correct memory association bug"
```

### CI Validation (GitHub Actions)

Pull requests automatically:
- ✅ Validate all commit messages
- ✅ Run tests and type checking
- ✅ Build the project

PRs cannot be merged until all checks pass.

## Pull Request Process

1. **Fork the repository**
2. **Create a feature branch**
   ```bash
   git checkout -b feat/your-feature
   # or
   git checkout -b fix/your-bugfix
   ```

3. **Make changes with conventional commits**
   ```bash
   npm run commit  # Interactive prompt
   ```

4. **Push and create PR**
   ```bash
   git push origin feat/your-feature
   ```

5. **Wait for CI checks** - PR must pass all checks

6. **After merge to main** - Automated release publishes to npm

## Testing

```bash
# Run all tests
npm test

# Watch mode
npm run test:watch

# Coverage report
npm run test:coverage

# Type checking
npm run typecheck
```

## Code Style

- Use TypeScript strict mode
- Follow existing code patterns
- Add tests for new features
- Update documentation for API changes

## Release Process

**Automated** - No manual intervention needed:

1. Merge PR to `main`
2. GitHub Actions analyzes commits
3. Determines version bump
4. Generates changelog
5. Publishes to npm
6. Creates GitHub release

See [CLAUDE.md](./CLAUDE.md#publishing-workflow) for details.

## Need Help?

- Open an issue for bugs
- Start a discussion for feature requests
- Check [CLAUDE.md](./CLAUDE.md) for architecture details
- Check [INSTALLATION.md](./INSTALLATION.md) for setup guides

## License

By contributing, you agree that your contributions will be licensed under the MIT License.

