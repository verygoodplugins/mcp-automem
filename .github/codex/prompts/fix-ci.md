# Fix CI Failures

You are fixing CI failures for a VGP MCP server. These are TypeScript projects using:
- MCP SDK (@modelcontextprotocol/sdk)
- Vitest for testing
- ESLint 9 (flat config) + Prettier
- Strict TypeScript

## Your Task

Analyze the test failures and CodeRabbit comments below, then make the **minimal changes** needed to fix them.

## Rules

1. **Be surgical** - Only change what's necessary to fix the specific issue
2. **Don't refactor** - Resist the urge to "improve" adjacent code
3. **Match existing style** - Follow the patterns already in the codebase
4. **Preserve API** - Don't change public interfaces unless the fix requires it
5. **Keep tests passing** - Your fix should not break other tests

## Common Fixes

- **Type errors**: Add proper types, handle null/undefined cases
- **Test failures**: Fix the implementation to match expected behavior, or update test expectations if the test is wrong
- **Lint errors**: Follow ESLint rules, use proper formatting
- **Import errors**: Ensure all imports are correct and files exist

## What NOT to Do

- Don't add new features
- Don't refactor working code
- Don't change error messages unnecessarily  
- Don't add excessive comments
- Don't modify package.json unless required
