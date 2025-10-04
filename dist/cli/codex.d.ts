interface CodexSetupOptions {
    rulesPath?: string;
    projectName?: string;
    dryRun?: boolean;
    quiet?: boolean;
}
export declare function applyCodexSetup(cliOptions: CodexSetupOptions): Promise<void>;
export declare function runCodexSetup(args?: string[]): Promise<void>;
export {};
//# sourceMappingURL=codex.d.ts.map