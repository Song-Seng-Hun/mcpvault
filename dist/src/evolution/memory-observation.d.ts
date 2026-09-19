export declare const MEMORY_OBSERVED_ENDPOINTS: string[];
export interface MemoryDeliveryEvidence {
    status: 'delivered' | 'not_needed' | 'route_only' | 'no_match' | 'unavailable';
    partial: boolean;
    resources: Array<{
        resourceId: string;
        revision: string;
        role: string;
        startLine?: number;
        endLine?: number;
        reason?: string;
        contentHash: string;
        returnedChars: number;
        truncated: boolean;
    }>;
    snapshot?: string;
}
/** Parse only server-returned fields. Never traverse source text, basis or suggested future reads. */
export declare function memoryObservation(endpoint: string, result: unknown): MemoryDeliveryEvidence | undefined;
//# sourceMappingURL=memory-observation.d.ts.map