# Automated Release Setup

This document guides you through completing the automated release setup.

## What's Configured

✅ **Local Enforcement** - Git hooks (Husky + commitlint)
✅ **CI/CD Workflows** - GitHub Actions for testing and releasing
✅ **Semantic Release** - Automated versioning and publishing
✅ **Conventional Commits** - Enforced commit message format

## Remaining Setup Steps

### 1. Verify NPM Trusted Publishing (Already Configured ✅)

**Good news!** This project uses npm's trusted publishing (provenance) system, which is more secure than tokens. The workflow is configured with:
- ✅ `id-token: write` permission for OIDC authentication
- ✅ `provenance: true` in semantic-release npm plugin
- ✅ `registry-url` configured in GitHub Actions

**Fallback:** If trusted publishing isn't available, the workflow falls back to `NPM_TOKEN` secret (optional).

### 2. Enable GitHub Actions (if needed)

1. Go to repository: `Settings` → `Actions` → `General`
2. Ensure "Allow all actions and reusable workflows" is selected
3. Under "Workflow permissions":
   - Select "Read and write permissions"
   - Check "Allow GitHub Actions to create and approve pull requests"

### 3. Configure Branch Protection (Recommended)

1. Go to: `Settings` → `Branches` → `Add branch protection rule`
2. Branch name pattern: `main`
3. Enable:
   - ✅ Require a pull request before merging
   - ✅ Require status checks to pass before merging
     - Add required checks: `test`, `lint-commits`
   - ✅ Require conversation resolution before merging
   - ✅ Do not allow bypassing the above settings

## Testing the Workflow

### Test Local Hooks

```bash
# This should fail
git commit --allow-empty -m "bad commit"

# This should pass
git commit --allow-empty -m "test: verify commit hooks"
```

### Test Automated Release

1. **Create a feature branch:**
   ```bash
   git checkout -b feat/test-automation
   ```

2. **Make changes with conventional commits:**
   ```bash
   npm run commit  # Interactive prompt
   # Or:
   git commit -m "feat: add test feature"
   ```

3. **Push and create PR:**
   ```bash
   git push origin feat/test-automation
   ```

4. **Verify CI runs:**
   - Check GitHub Actions tab
   - Ensure `test` and `lint-commits` jobs pass

5. **Merge PR:**
   - Once approved and checks pass, merge to `main`
   - Watch GitHub Actions for automatic release

6. **Verify release:**
   - Check GitHub Releases tab for new release
   - Check npm for new published version
   - Check CHANGELOG.md was updated

## How It Works

### Commit → Release Mapping

| Commit Type | Example | Version Bump | Release? |
|-------------|---------|--------------|----------|
| `feat:` | `feat: add new tool` | Minor (0.x.0) | ✅ Yes |
| `fix:` | `fix: correct bug` | Patch (0.0.x) | ✅ Yes |
| `feat!:` | `feat!: breaking change` | Major (x.0.0) | ✅ Yes |
| `perf:` | `perf: optimize query` | Patch (0.0.x) | ✅ Yes |
| `refactor:` | `refactor: clean code` | Patch (0.0.x) | ✅ Yes |
| `docs:` | `docs: update README` | No bump | ❌ No |
| `test:` | `test: add unit tests` | No bump | ❌ No |
| `chore:` | `chore: update deps` | No bump | ❌ No |
| `ci:` | `ci: update workflow` | No bump | ❌ No |

### Release Process

```
PR Merged to main
       ↓
GitHub Actions triggered
       ↓
semantic-release analyzes commits
       ↓
Determines version bump
       ↓
├─ Updates package.json
├─ Generates CHANGELOG.md
├─ Creates git tag
├─ Commits changes
└─ Pushes to GitHub
       ↓
npm publish triggered
       ↓
GitHub release created
       ↓
✅ Done!
```

## Troubleshooting

### "npm publish failed" error

With trusted publishing, npm authentication should work automatically via OIDC. If it fails:

1. **Check provenance is enabled:**
   - Verify `provenance: true` in `.releaserc.json`
   - Verify `id-token: write` permission in `release.yml`

2. **Fallback to token (optional):**
   - Create token at [npmjs.com/settings/tokens](https://www.npmjs.com/settings/tokens)
   - Add as `NPM_TOKEN` secret in repository settings
   - The workflow will automatically use it as fallback

### "Permission denied" on git push

- Check GitHub Actions has write permissions
- Settings → Actions → General → Workflow permissions

### Commits not triggering release

- Ensure commit follows conventional format
- Use `npm run commit` for interactive guidance
- Check `.releaserc.json` rules for non-releasing types

### Release skipped with "no release"

- No feat/fix/perf/refactor commits since last release
- Only docs/test/chore commits don't trigger releases
- This is expected behavior

## Rollback Process

If a release goes wrong:

```bash
# Revert the release commit
git revert HEAD

# Delete the git tag locally and remotely
git tag -d vX.Y.Z
git push origin :refs/tags/vX.Y.Z

# Unpublish from npm (within 72 hours)
npm unpublish @verygoodplugins/mcp-automem@X.Y.Z
```

## Resources

- [Conventional Commits](https://www.conventionalcommits.org/)
- [semantic-release](https://semantic-release.gitbook.io/)
- [commitlint](https://commitlint.js.org/)
- [GitHub Actions](https://docs.github.com/en/actions)

## Support

Questions? Check [CONTRIBUTING.md](../CONTRIBUTING.md) or open an issue.

