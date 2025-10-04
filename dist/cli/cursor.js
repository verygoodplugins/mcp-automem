import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
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
function checkCursorMcpConfigured() {
    const configPath = getCursorMcpConfigPath();
    let configured = false;
    if (fs.existsSync(configPath)) {
        try {
            const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
            configured = Boolean(config?.mcpServers?.automem || config?.mcpServers?.memory);
        }
        catch {
            configured = false;
        }
    }
    return { configured, configPath };
}
export async function applyCursorSetup(cliOptions) {
    const projectRoot = process.cwd();
    const projectName = cliOptions.projectName ?? detectProjectName();
    // Project-level installation
    const targetDir = cliOptions.targetDir ?? path.join(projectRoot, '.cursor', 'rules');
    const vars = {
        PROJECT_NAME: projectName,
        CURRENT_MONTH: getCurrentMonth(),
    };
    log(`\n🔧 Setting up Cursor AutoMem for: ${projectName}`, cliOptions.quiet);
    log(`📁 Installing automem.mdc rule to: ${targetDir}\n`, cliOptions.quiet);
    // Create directory structure
    if (!cliOptions.dryRun) {
        fs.mkdirSync(targetDir, { recursive: true });
    }
    // Install automem.mdc rule
    const templatePath = path.join(TEMPLATE_ROOT, 'automem.mdc.template');
    const targetPath = path.join(targetDir, 'automem.mdc');
    const templateContent = fs.readFileSync(templatePath, 'utf8');
    const processedContent = replaceTemplateVars(templateContent, vars);
    writeFileWithBackup(targetPath, processedContent, cliOptions);
    // Check Cursor MCP server configuration
    const mcpCheck = checkCursorMcpConfigured();
    log('\n📊 Configuration Status:', cliOptions.quiet);
    log(`  ✅ Cursor rule installed: ${targetPath}`, cliOptions.quiet);
    if (!mcpCheck.configured) {
        log(`\n  ⚠️  AutoMem MCP server not configured in Cursor`, cliOptions.quiet);
        log(`\n  Add to ${mcpCheck.configPath}:`, cliOptions.quiet);
        log(`\n  {`, cliOptions.quiet);
        log(`    "mcpServers": {`, cliOptions.quiet);
        log(`      "memory": {`, cliOptions.quiet);
        log(`        "command": "npx",`, cliOptions.quiet);
        log(`        "args": ["@verygoodplugins/mcp-automem"],`, cliOptions.quiet);
        log(`        "env": {`, cliOptions.quiet);
        log(`          "AUTOMEM_ENDPOINT": "http://127.0.0.1:8001"`, cliOptions.quiet);
        log(`        }`, cliOptions.quiet);
        log(`      }`, cliOptions.quiet);
        log(`    }`, cliOptions.quiet);
        log(`  }`, cliOptions.quiet);
    }
    else {
        log(`  ✅ MCP server configured in Cursor`, cliOptions.quiet);
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
                // deprecated; ignore
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