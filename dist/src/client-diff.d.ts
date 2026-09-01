export interface ClientPatchHunk {
    oldString: string;
    newString: string;
}
export interface ClientNoteUpdatePlan {
    changed: boolean;
    expectedRevision: string;
    mode: 'patch' | 'write';
    patches: ClientPatchHunk[];
    /** Present for a full-write fallback; never contains a password or token. */
    content?: string;
    reason?: 'empty_original' | 'insertion_only' | 'patch_larger_than_write' | 'input_too_large';
}
export interface ClientDiffOptions {
    /** Do not build a patch larger than this many Unicode characters. */
    maxPatchChars?: number;
    /** Protect the client from converting an extremely large document to code-point arrays. */
    maxInputChars?: number;
}
/**
 * Builds a safe client-side note mutation plan. A patch is only proposed for
 * a non-empty replacement/deletion; insertions fall back to a full write so a
 * missing oldString can never be applied ambiguously. The server must still
 * enforce expectedRevision, authorization, and path policy.
 */
export declare function createNoteUpdatePlan(original: string, updated: string, expectedRevision: string, options?: ClientDiffOptions): ClientNoteUpdatePlan;
//# sourceMappingURL=client-diff.d.ts.map