/** Data-only worked shapes. Replace examples with observed evidence, never
 * submit an example as proof. Validators remain authoritative. */
export declare function workshopInputExample(step: string, account?: string, source?: {
    path: string;
    revision: string;
}): Record<string, unknown>;
export declare function workshopInputGuide(step: string, account?: string, source?: {
    path: string;
    revision: string;
}): {
    example: Record<string, unknown>;
    inputSchema: Record<string, unknown>;
    notice: string;
};
//# sourceMappingURL=workshop-input-guide.d.ts.map