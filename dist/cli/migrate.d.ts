interface MigrateOptions {
    from: 'manual' | 'none';
    to: 'cursor' | 'claude-code';
    projectDir?: string;
    dryRun?: boolean;
    yes?: boolean;
    quiet?: boolean;
}
export declare function runMigration(options: MigrateOptions): Promise<void>;
export declare function runMigrateCommand(args?: string[]): Promise<void>;
export {};
//# sourceMappingURL=migrate.d.ts.map