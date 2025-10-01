interface UninstallOptions {
    platform: 'cursor' | 'claude-code';
    projectDir?: string;
    cleanAll?: boolean;
    dryRun?: boolean;
    yes?: boolean;
    quiet?: boolean;
}
export declare function runUninstall(options: UninstallOptions): Promise<void>;
export declare function runUninstallCommand(args?: string[]): Promise<void>;
export {};
//# sourceMappingURL=uninstall.d.ts.map