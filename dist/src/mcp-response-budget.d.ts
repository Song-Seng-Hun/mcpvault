/** Caller must reject mutation replays before dispatch and authorize every read. */
export declare function readResponseView(response: any, path: string, cursor: unknown, basis: unknown, budget: number): any;
/** MCP discovery keeps complete schemas; oversized translations use code-owned prose. */
export declare function boundedToolCatalog<T>(original: readonly T[], localized: readonly T[], cursor?: unknown): {
    tools: T[];
    nextCursor?: string;
};
export declare function enforceResponseBudget(response: any, requestedMaxChars: unknown, pulseRequest?: Record<string, unknown>): any;
export declare function normalizedResponseBudget(value: unknown, inputSchema?: Record<string, unknown>): number;
//# sourceMappingURL=mcp-response-budget.d.ts.map