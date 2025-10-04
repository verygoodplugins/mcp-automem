interface CursorSetupOptions {
    targetDir?: string;
    projectName?: string;
    dryRun?: boolean;
    quiet?: boolean;
}
export declare function applyCursorSetup(cliOptions: CursorSetupOptions): Promise<void>;
export declare function runCursorSetup(args?: string[]): Promise<void>;
export {};
//# sourceMappingURL=cursor.d.ts.map