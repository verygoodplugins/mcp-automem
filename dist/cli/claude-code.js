import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
const TEMPLATE_ROOT = path.resolve(fileURLToPath(new URL('../../templates/claude-code', import.meta.url)));
function log(message, quiet) {
    if (!quiet) {
        console.log(message);
    }
}
function ensureDir(dirPath, options) {
    if (!options.dryRun) {
        fs.mkdirSync(dirPath, { recursive: true });
    }
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
        log(`dry-run: would write ${targetPath}`, options.quiet);
        return;
    }
    const dir = path.dirname(targetPath);
    fs.mkdirSync(dir, { recursive: true });
    if (fs.existsSync(targetPath)) {
        const current = fs.readFileSync(targetPath, 'utf8');
        if (current === content) {
            return;
        }
        const backup = backupPath(targetPath);
        fs.copyFileSync(targetPath, backup);
        log(`backup created: ${backup}`, options.quiet);
    }
    fs.writeFileSync(targetPath, content, 'utf8');
}
function copyTemplateFile(relativePath, options) {
    const templatePath = path.join(TEMPLATE_ROOT, relativePath);
    const targetPath = path.join(options.targetDir ?? '', relativePath);
    const templateContent = fs.readFileSync(templatePath, 'utf8');
    if (fs.existsSync(targetPath)) {
        const current = fs.readFileSync(targetPath, 'utf8');
        if (current === templateContent) {
            log(`unchanged ${relativePath}`, options.quiet);
            return;
        }
    }
    writeFileWithBackup(targetPath, templateContent, options);
    if (options.dryRun) {
        log(`dry-run: would update ${relativePath}`, options.quiet);
        return;
    }
    const ext = path.extname(relativePath);
    if (ext === '.sh' || ext === '.py') {
        fs.chmodSync(targetPath, 0o755);
    }
    log(`updated ${relativePath}`, options.quiet);
}
function copyTemplateDirectory(relativeDir, options) {
    const templateDir = path.join(TEMPLATE_ROOT, relativeDir);
    if (!fs.existsSync(templateDir)) {
        return;
    }
    const entries = fs.readdirSync(templateDir, { withFileTypes: true });
    for (const entry of entries) {
        if (entry.isDirectory()) {
            copyTemplateDirectory(path.join(relativeDir, entry.name), options);
        }
        else if (entry.isFile()) {
            copyTemplateFile(path.join(relativeDir, entry.name), options);
        }
    }
}
function mergeUniqueStrings(target = [], additions) {
    const set = new Set(target);
    for (const value of additions) {
        if (!set.has(value)) {
            target.push(value);
            set.add(value);
        }
    }
    return target;
}
function mergeHookEntries(target = [], additions) {
    for (const addition of additions) {
        const matcher = addition?.matcher;
        if (!matcher)
            continue;
        const existingIndex = target.findIndex((item) => item?.matcher === matcher);
        if (existingIndex === -1) {
            target.push(addition);
            continue;
        }
        const existingHooks = target[existingIndex].hooks ?? [];
        const existingCommands = new Set(existingHooks.map((hook) => hook.command));
        for (const hook of addition.hooks ?? []) {
            if (!existingCommands.has(hook.command)) {
                existingHooks.push(hook);
                existingCommands.add(hook.command);
            }
        }
        target[existingIndex].hooks = existingHooks;
    }
    return target;
}
function mergeSettings(targetSettings, templateSettings) {
    const merged = { ...targetSettings };
    if (!merged.env && templateSettings.env) {
        merged.env = templateSettings.env;
    }
    if (!merged.statusLine && templateSettings.statusLine) {
        merged.statusLine = templateSettings.statusLine;
    }
    if (!merged.model && templateSettings.model) {
        merged.model = templateSettings.model;
    }
    merged.permissions = merged.permissions ?? {};
    const templatePermissions = templateSettings.permissions ?? {};
    merged.permissions.allow = mergeUniqueStrings(merged.permissions.allow ?? [], templatePermissions.allow ?? []);
    merged.permissions.deny = mergeUniqueStrings(merged.permissions.deny ?? [], templatePermissions.deny ?? []);
    merged.permissions.ask = mergeUniqueStrings(merged.permissions.ask ?? [], templatePermissions.ask ?? []);
    if (!merged.permissions.defaultMode && templatePermissions.defaultMode) {
        merged.permissions.defaultMode = templatePermissions.defaultMode;
    }
    merged.hooks = merged.hooks ?? {};
    const templateHooks = templateSettings.hooks ?? {};
    for (const [category, hookList] of Object.entries(templateHooks)) {
        const existingList = Array.isArray(merged.hooks[category]) ? merged.hooks[category] : [];
        merged.hooks[category] = mergeHookEntries(existingList, hookList);
    }
    return merged;
}
function mergeSettingsFile(targetDir, options) {
    const templateSettingsPath = path.join(TEMPLATE_ROOT, 'settings.json');
    const templateSettings = JSON.parse(fs.readFileSync(templateSettingsPath, 'utf8'));
    const targetPath = path.join(targetDir, 'settings.json');
    if (!fs.existsSync(targetPath)) {
        writeFileWithBackup(targetPath, `${JSON.stringify(templateSettings, null, 2)}\n`, options);
        log('installed settings.json', options.quiet);
        return;
    }
    const raw = fs.readFileSync(targetPath, 'utf8');
    let currentSettings;
    try {
        currentSettings = JSON.parse(raw);
    }
    catch (error) {
        throw new Error(`Cannot parse existing settings.json at ${targetPath}: ${error.message}`);
    }
    const merged = mergeSettings(currentSettings, templateSettings);
    const output = `${JSON.stringify(merged, null, 2)}\n`;
    if (output === raw) {
        log('settings.json already up to date', options.quiet);
        return;
    }
    writeFileWithBackup(targetPath, output, options);
    log('updated settings.json', options.quiet);
}
function parseClaudeArgs(args) {
    const options = {};
    for (let i = 0; i < args.length; i += 1) {
        const arg = args[i];
        switch (arg) {
            case '--dir':
                options.targetDir = args[i + 1];
                i += 1;
                break;
            case '--dry-run':
                options.dryRun = true;
                break;
            case '--yes':
            case '-y':
                options.yes = true;
                break;
            case '--quiet':
                options.quiet = true;
                break;
            case '--profile': {
                const value = (args[i + 1] || '').toLowerCase();
                if (value === 'lean' || value === 'extras') {
                    options.profile = value;
                    i += 1;
                }
                break;
            }
            default:
                break;
        }
    }
    return options;
}
export async function applyClaudeCodeSetup(cliOptions) {
    const options = {
        ...cliOptions,
        targetDir: cliOptions.targetDir ?? path.join(os.homedir(), '.claude'),
    };
    const targetDir = options.targetDir ?? path.join(os.homedir(), '.claude');
    log(`Configuring Claude Code automation in ${targetDir}`, options.quiet);
    if (!options.dryRun) {
        fs.mkdirSync(targetDir, { recursive: true });
    }
    ensureDir(path.join(targetDir, 'hooks'), options);
    ensureDir(path.join(targetDir, 'scripts'), options);
    ensureDir(path.join(targetDir, 'logs'), options);
    // If a profile is specified, apply it directly (replace settings.json with backup)
    if (options.profile) {
        const profilePath = path.join(TEMPLATE_ROOT, 'profiles', `settings.${options.profile}.json`);
        if (!fs.existsSync(profilePath)) {
            throw new Error(`Profile not found: ${options.profile}`);
        }
        const profileContent = fs.readFileSync(profilePath, 'utf8');
        writeFileWithBackup(path.join(targetDir, 'settings.json'), `${profileContent}\n`, options);
        log(`applied profile: ${options.profile}`, options.quiet);
    }
    else {
        // Merge default settings template if no profile selected
        mergeSettingsFile(targetDir, options);
    }
    copyTemplateDirectory('hooks', { ...options, targetDir });
    copyTemplateDirectory('scripts', { ...options, targetDir });
    log('Claude Code automation assets installed.', options.quiet);
    log('Restart Claude Code to load the updated hooks.', options.quiet);
}
export async function runClaudeCodeSetup(args = []) {
    const options = parseClaudeArgs(args);
    await applyClaudeCodeSetup(options);
}
//# sourceMappingURL=claude-code.js.map