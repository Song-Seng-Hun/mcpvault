export interface ContextFragment {
    id: string;
    text: string;
    /** Higher priority fragments are retained before lower priority fragments. */
    priority?: number;
    /** Required fragments are considered before optional fragments. */
    required?: boolean;
    /** Optional per-fragment cap, in Unicode characters. */
    maxChars?: number;
    /** Optional authoritative note identity used to avoid duplicate context. */
    source?: {
        path: string;
        revision: string;
    };
    /** Optional caller-defined identity for non-note fragments. */
    dedupeKey?: string;
}
export interface PackedContextFragment {
    id: string;
    text: string;
    truncated: boolean;
}
export interface PackedContext {
    fragments: PackedContextFragment[];
    text: string;
    usedChars: number;
    omittedIds: string[];
    truncatedIds: string[];
    deduplicatedIds: string[];
}
/**
 * Deterministic client-side context packing. It does not interpret content or
 * grant access; it only chooses which already-authorized fragments fit in a
 * caller-provided character budget.
 */
export declare class ContextBudgeter {
    pack(fragments: ContextFragment[], maxChars: number): PackedContext;
    estimateTokens(text: string): number;
}
//# sourceMappingURL=client-context.d.ts.map