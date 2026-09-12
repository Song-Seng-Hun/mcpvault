export interface ParsedCliArgs {
    vaultPathArg: string;
    readOnly: boolean;
    restPort?: number;
    mcpHttpPort?: number;
    mcpHttpHost?: string;
    mcpHttpTlsCert?: string;
    mcpHttpTlsKey?: string;
    economyConfig?: string;
    roleplayConfig?: string;
    skillEvolutionConfig?: string;
    explanationConfig?: string;
    benchmarkConfig?: string;
    featuresConfig?: string;
    ownerActivityConfig?: string;
    maintenanceConfig?: string;
    /** Dedicated HTTP process; omitted preserves legacy stdio behavior. */
    stdio?: false;
}
/**
 * Parse runtime options without importing server.ts, which starts the MCP
 * server as a side effect. Unknown positional arguments remain part of the
 * vault path so unquoted paths with spaces continue to work.
 */
export declare function parseCliArgs(args: string[]): ParsedCliArgs;
//# sourceMappingURL=cli.d.ts.map