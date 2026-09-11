export declare const BENCHMARK_HOST_USAGE = "Host-only benchmark maintenance (stop the configured writer before mutations).\nUsage: node scripts/benchmark-host.mjs inspect|open|finalize|close|cancel|project|evidence <absolute-vault> <absolute-private-config> <human-operator> <challenge-id> [--expected-revision REV] [--request-id ID] [--expected-projection-revision REV] [--economy-config ABSOLUTE_FILE] [--reason TEXT]\nevidence additionally requires --entry-id ID --fields outcome,scores --shareable true (one or both fields). inspect and initiative-status are read-only. Global absence: node scripts/benchmark-host.mjs initiative-status <absolute-vault> <absolute-private-config> <human-operator>. A missing live ledger leaves rewarded settlement unknown. Mutation guards and approvals are never inferred; no model, account, answer/key file, wallet or supply cap is created.";
export interface BenchmarkHostArguments {
    operation: 'inspect' | 'open' | 'finalize' | 'close' | 'cancel' | 'project' | 'evidence' | 'initiative-status';
    vaultPath: string;
    configPath: string;
    actor: string;
    economyConfig?: string;
    params: Record<string, unknown>;
}
export declare function parseBenchmarkHostArgs(args: string[]): BenchmarkHostArguments;
/** Offline host adapter. No listeners, enrollment, implicit approvals or arbitrary
 * ledger commands. Reuses the actual auth/moderation services, without constructing
 * the server's startup maintenance/index lifecycle for read-only inspection. */
export declare function runBenchmarkHost(args: string[]): Promise<Record<string, unknown>>;
//# sourceMappingURL=benchmark-host-cli.d.ts.map