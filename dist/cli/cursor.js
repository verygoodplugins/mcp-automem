import fs from 'fs';
import os from 'os';
import path from 'path';
import readline from 'readline';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
// Read version from package.json - single source of truth
function getPackageVersion() {
    const packageJsonPath = path.resolve(fileURLToPath(new URL('../../package.json', import.meta.url)));
    try {
        const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
        return pkg.version || '0.0.0';
    }
    catch {
        return '0.0.0';
    }
}
const PACKAGE_VERSION = getPackageVersion();
function extractMdcVersion(content) {
    const match = content.match(/<!--\s*automem-mdc-version:\s*([\d.]+)\s*-->/);
    return match ? match[1] : null;
}
function compareVersions(v1, v2) {
    const parts1 = v1.split('.').map(Number);
    const parts2 = v2.split('.').map(Number);
    for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
        const p1 = parts1[i] || 0;
        const p2 = parts2[i] || 0;
        if (p1 > p2)
            return 1;
        if (p1 < p2)
            return -1;
    }
    return 0;
}
async function promptUser(question) {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });
    return new Promise((resolve) => {
        rl.question(question, (answer) => {
            rl.close();
            const normalized = answer.trim().toLowerCase();
            resolve(normalized === '' || normalized === 'y' || normalized === 'yes');
        });
    });
}
const TEMPLATE_ROOT = path.resolve(fileURLToPath(new URL('../../templates/cursor', import.meta.url)));
function log(message, quiet) {
    if (!quiet) {
        console.log(message);
    }
}
function detectProjectName() {
    // 1. Try package.json
    if (fs.existsSync('package.json')) {
        try {
            const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
            if (pkg.name) {
                return pkg.name.replace(/^@.*?\//, ''); // Remove scope
            }
        }
        catch {
            // Continue to next method
        }
    }
    // 2. Try git remote
    try {
        const remote = execSync('git remote get-url origin 2>/dev/null', { encoding: 'utf8' }).trim();
        if (remote) {
            const match = remote.match(/\/([^\/]+?)(\.git)?$/);
            if (match) {
                return match[1];
            }
        }
    }
    catch {
        // Continue to next method
    }
    // 3. Fall back to directory name
    return path.basename(process.cwd());
}
function getCurrentMonth() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    return `${year}-${month}`;
}
function replaceTemplateVars(content, vars) {
    let result = content;
    for (const [key, value] of Object.entries(vars)) {
        result = result.replace(new RegExp(`{{${key}}}`, 'g'), value);
    }
    return result;
}
function backupPath(filePath) {
    let candidate = `${filePath}.bak`;
    let counter = 1;
    while (fs.existsSync(candidate)) {
        candidate = `${filePath}.bak.${counter}`;
        counter += 1;
    }
    return candidate;
}
function writeFileWithBackup(targetPath, content, options) {
    if (options.dryRun) {
        log(`[DRY RUN] Would write: ${targetPath}`, options.quiet);
        return;
    }
    const dir = path.dirname(targetPath);
    fs.mkdirSync(dir, { recursive: true });
    const fileExisted = fs.existsSync(targetPath);
    if (fileExisted) {
        const current = fs.readFileSync(targetPath, 'utf8');
        if (current === content) {
            log(`✓ Unchanged: ${path.basename(targetPath)}`, options.quiet);
            return;
        }
        const backup = backupPath(targetPath);
        fs.copyFileSync(targetPath, backup);
        log(`📦 Backup created: ${backup}`, options.quiet);
    }
    fs.writeFileSync(targetPath, content, 'utf8');
    log(`✅ ${fileExisted ? 'Updated' : 'Created'}: ${path.basename(targetPath)}`, options.quiet);
}
function getCursorMcpConfigPath() {
    const homeDir = os.homedir();
    return path.join(homeDir, '.cursor', 'mcp.json');
}
function sanitizeCursorServerName(name) {
    // Cursor tool names use underscore-delimited prefixes like `mcp_<server>_<tool>`.
    // Normalize any non-identifier characters to underscores to match typical client behavior.
    return name.replace(/[^A-Za-z0-9_]/g, '_');
}
function isCursorAutoMemServerConfig(serverConfig) {
    if (!serverConfig || typeof serverConfig !== 'object') {
        return false;
    }
    const args = serverConfig.args;
    if (Array.isArray(args)) {
        for (const arg of args) {
            if (typeof arg === 'string' && arg.includes('@verygoodplugins/mcp-automem')) {
                return true;
            }
            if (typeof arg === 'string' && arg.includes('mcp-automem')) {
                return true;
            }
        }
    }
    const env = serverConfig.env;
    if (env && typeof env === 'object') {
        if ('AUTOMEM_ENDPOINT' in env || 'AUTOMEM_API_KEY' in env || 'AUTOMEM_API_TOKEN' in env) {
            return true;
        }
    }
    return false;
}
function detectCursorAutoMemServerName(configPath) {
    if (!fs.existsSync(configPath)) {
        return null;
    }
    try {
        const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        const servers = config?.mcpServers;
        if (!servers || typeof servers !== 'object') {
            return null;
        }
        // Prefer conventional names when multiple servers exist.
        for (const preferred of ['memory', 'automem']) {
            if (servers[preferred] && isCursorAutoMemServerConfig(servers[preferred])) {
                return preferred;
            }
        }
        for (const [name, serverConfig] of Object.entries(servers)) {
            if (isCursorAutoMemServerConfig(serverConfig)) {
                return name;
            }
        }
        // Fall back to known keys even if we couldn't positively identify args/env.
        if (servers.memory)
            return 'memory';
        if (servers.automem)
            return 'automem';
        return null;
    }
    catch {
        return null;
    }
}
function checkCursorMcpConfigured() {
    const configPath = getCursorMcpConfigPath();
    const serverName = detectCursorAutoMemServerName(configPath) ?? undefined;
    return { configured: Boolean(serverName), configPath, serverName };
}
export async function applyCursorSetup(cliOptions) {
    const projectRoot = process.cwd();
    const projectName = cliOptions.projectName ?? detectProjectName();
    // Project-level installation
    const targetDir = cliOptions.targetDir ?? path.join(projectRoot, '.cursor', 'rules');
    const targetPath = path.join(targetDir, 'automem.mdc');
    // Check for existing installation and version
    let existingVersion = null;
    let shouldUpdate = true;
    if (fs.existsSync(targetPath)) {
        const existingContent = fs.readFileSync(targetPath, 'utf8');
        existingVersion = extractMdcVersion(existingContent);
        if (existingVersion) {
            const comparison = compareVersions(PACKAGE_VERSION, existingVersion);
            if (comparison === 0) {
                // Same version
                log(`\n✅ automem.mdc is already up to date (v${existingVersion})`, cliOptions.quiet);
                shouldUpdate = false;
            }
            else if (comparison > 0) {
                // New version available
                log(`\n📦 Found existing automem.mdc v${existingVersion}`, cliOptions.quiet);
                log(`   New version available: v${PACKAGE_VERSION}`, cliOptions.quiet);
                log(`\n   What's new in v${PACKAGE_VERSION}:`, cliOptions.quiet);
                log(`   • Expansion filtering: expand_min_importance, expand_min_strength`, cliOptions.quiet);
                log(`   • Reduces noise in multi-hop and graph expansion results`, cliOptions.quiet);
                log(`   • Updated examples and best practices\n`, cliOptions.quiet);
                if (!cliOptions.skipPrompts && !cliOptions.dryRun) {
                    shouldUpdate = await promptUser('Update to latest version? [Y/n] ');
                    if (!shouldUpdate) {
                        log('Skipping update. Run with --yes to auto-update next time.\n', cliOptions.quiet);
                    }
                }
            }
            else {
                // Existing is newer (shouldn't happen normally)
                log(`\n⚠️  Existing automem.mdc (v${existingVersion}) is newer than package (v${PACKAGE_VERSION})`, cliOptions.quiet);
                shouldUpdate = false;
            }
        }
        else {
            // No version marker - legacy file
            log(`\n📦 Found legacy automem.mdc (no version marker)`, cliOptions.quiet);
            log(`   Updating to v${PACKAGE_VERSION} with new features.\n`, cliOptions.quiet);
            if (!cliOptions.skipPrompts && !cliOptions.dryRun) {
                shouldUpdate = await promptUser('Update to latest version? [Y/n] ');
            }
        }
    }
    if (!shouldUpdate) {
        // Skip to MCP config check
        const mcpCheck = checkCursorMcpConfigured();
        if (!mcpCheck.configured) {
            log(`\n⚠️  AutoMem MCP server not configured in Cursor`, cliOptions.quiet);
            log(`   Add to ${mcpCheck.configPath} - see README for config snippet.`, cliOptions.quiet);
        }
        return;
    }
    const mcpCheck = checkCursorMcpConfigured();
    const cursorServerName = mcpCheck.serverName ?? 'memory';
    const vars = {
        PROJECT_NAME: projectName,
        CURRENT_MONTH: getCurrentMonth(),
        VERSION: PACKAGE_VERSION,
        MCP_SERVER_NAME: cursorServerName,
        MCP_TOOL_PREFIX: `mcp_${sanitizeCursorServerName(cursorServerName)}_`,
    };
    log(`\n🔧 Setting up Cursor AutoMem for: ${projectName}`, cliOptions.quiet);
    log(`📁 Installing automem.mdc rule to: ${targetDir}\n`, cliOptions.quiet);
    // Create directory structure
    if (!cliOptions.dryRun) {
        fs.mkdirSync(targetDir, { recursive: true });
    }
    // Install automem.mdc rule
    const templatePath = path.join(TEMPLATE_ROOT, 'automem.mdc.template');
    const templateContent = fs.readFileSync(templatePath, 'utf8');
    const processedContent = replaceTemplateVars(templateContent, vars);
    writeFileWithBackup(targetPath, processedContent, cliOptions);
    log('\n📊 Configuration Status:', cliOptions.quiet);
    log(`  ✅ Cursor rule installed: ${targetPath}`, cliOptions.quiet);
    if (!mcpCheck.configured) {
        log(`\n  ⚠️  AutoMem MCP server not configured in Cursor`, cliOptions.quiet);
        log(`\n  Add to ${mcpCheck.configPath}:`, cliOptions.quiet);
        log(`\n  {`, cliOptions.quiet);
        log(`    "mcpServers": {`, cliOptions.quiet);
        log(`      "memory": {`, cliOptions.quiet);
        log(`        "command": "npx",`, cliOptions.quiet);
        log(`        "args": ["-y", "@verygoodplugins/mcp-automem"],`, cliOptions.quiet);
        log(`        "env": {`, cliOptions.quiet);
        log(`          "AUTOMEM_ENDPOINT": "http://127.0.0.1:8001"`, cliOptions.quiet);
        log(`        }`, cliOptions.quiet);
        log(`      }`, cliOptions.quiet);
        log(`    }`, cliOptions.quiet);
        log(`  }`, cliOptions.quiet);
    }
    else {
        log(`  ✅ MCP server configured in Cursor (${cursorServerName})`, cliOptions.quiet);
    }
    log('\n✨ Cursor AutoMem setup complete!\n', cliOptions.quiet);
    log('Next steps:', cliOptions.quiet);
    if (!mcpCheck.configured) {
        log('  1. Add MCP server config (see above)', cliOptions.quiet);
        log('  2. Restart Cursor to load the configuration', cliOptions.quiet);
        log('  3. Start a conversation - Cursor will use automem.mdc rule', cliOptions.quiet);
    }
    else {
        log('  1. Restart Cursor to load the new rule', cliOptions.quiet);
        log('  2. Start a conversation - Cursor will recall and store memories as needed', cliOptions.quiet);
    }
    log('\n💡 Tip: For memory-first behavior across ALL projects, add memory', cliOptions.quiet);
    log('   instructions to Cursor Settings > General > Rules for AI', cliOptions.quiet);
}
function parseCursorArgs(args) {
    const options = {};
    for (let i = 0; i < args.length; i += 1) {
        const arg = args[i];
        switch (arg) {
            case '--dir':
                if (i + 1 >= args.length) {
                    console.error('Error: --dir requires a path value');
                    process.exit(1);
                }
                options.targetDir = args[i + 1];
                i += 1;
                break;
            case '--name':
                if (i + 1 >= args.length) {
                    console.error('Error: --name requires a value');
                    process.exit(1);
                }
                options.projectName = args[i + 1];
                i += 1;
                break;
            case '--desc':
            case '--description':
                // deprecated; ignore
                i += 1;
                break;
            case '--dry-run':
                options.dryRun = true;
                break;
            case '--yes':
            case '-y':
                options.skipPrompts = true;
                break;
            case '--quiet':
                options.quiet = true;
                break;
            default:
                break;
        }
    }
    return options;
}
export async function runCursorSetup(args = []) {
    const options = parseCursorArgs(args);
    await applyCursorSetup(options);
}
//# sourceMappingURL=cursor.js.map