import type { Tool } from '@modelcontextprotocol/server';
import type { BenchmarkOperation } from './benchmark-service.js';
export declare const BENCHMARK_TOOL_ENDPOINTS: {
    readonly list_benchmarks: 'benchmark.list';
    readonly read_benchmark: 'benchmark.read';
    readonly submit_benchmark: 'benchmark.submit';
    readonly review_benchmark: 'benchmark.review';
    readonly finalize_benchmark: 'benchmark.finalize';
};
export declare const BENCHMARK_MUTATING_TOOLS: readonly ['submit_benchmark', 'review_benchmark', 'finalize_benchmark'];
export declare const BENCHMARK_MUTATING_ENDPOINTS: readonly ['benchmark.submit', 'benchmark.review', 'benchmark.finalize'];
export declare function benchmarkOperation(name: string): BenchmarkOperation | undefined;
export declare function getBenchmarkTools(): Tool[];
//# sourceMappingURL=benchmark-tools.d.ts.map