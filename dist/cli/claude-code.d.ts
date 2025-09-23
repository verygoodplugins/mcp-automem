interface ClaudeCodeSetupOptions {
    targetDir?: string;
    dryRun?: boolean;
    yes?: boolean;
}
export declare function applyClaudeCodeSetup(cliOptions: ClaudeCodeSetupOptions): Promise<void>;
export declare function runClaudeCodeSetup(args?: string[]): Promise<void>;
export {};
//# sourceMappingURL=claude-code.d.ts.map