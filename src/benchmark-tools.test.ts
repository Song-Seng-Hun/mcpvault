import {expect,test} from 'vitest';
import {getBenchmarkTools,BENCHMARK_TOOL_ENDPOINTS,BENCHMARK_MUTATING_TOOLS,benchmarkOperation} from './benchmark-tools.js';
test('adapter mappings expose only bounded agent operations, never host opening or issuance',()=>{
 const tools=getBenchmarkTools();expect(tools).toHaveLength(5);
 expect(Object.values(BENCHMARK_TOOL_ENDPOINTS)).toEqual(['benchmark.list','benchmark.read','benchmark.submit','benchmark.review','benchmark.finalize']);
 expect(BENCHMARK_MUTATING_TOOLS).toEqual(['submit_benchmark','review_benchmark','finalize_benchmark']);
 for(const t of tools){expect(t.inputSchema.additionalProperties).toBe(false);expect(benchmarkOperation(t.name)).toBe(BENCHMARK_TOOL_ENDPOINTS[t.name as keyof typeof BENCHMARK_TOOL_ENDPOINTS].split('.')[1]);}
 for(const op of ['open','reserve_program','issue','award_program','finalizeAnything'])expect(benchmarkOperation(op)).toBeUndefined();
});
