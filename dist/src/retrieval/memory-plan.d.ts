import type { MemoryRole } from '../memory-contract.js';
export declare const MEMORY_INTENTS: readonly ['self_contained', 'resume', 'procedure', 'past_decision', 'incident', 'environment'];
export type MemoryIntent = typeof MEMORY_INTENTS[number];
export interface MemoryTaskContext {
    intent: MemoryIntent;
}
export interface MemoryPlan {
    intent: MemoryIntent;
    strategy: 'none' | 'continuity' | 'selective';
    mandatoryRules: 'unchanged';
    preferredRoles: MemoryRole[];
}
/** Optional relevance only. The caller must still enforce scope, filters and corrections. */
export declare function planMemory(mode: string, context: unknown, explicitRead: boolean): MemoryPlan | undefined;
//# sourceMappingURL=memory-plan.d.ts.map