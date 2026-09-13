export interface CompilationBundle {
    version: 1;
    bundleId: string;
    documentId: string;
    accountId: string;
    projectId: string;
    documentPath: string;
    chapterRoot: string;
    sourceRevision: string;
    authority: string;
    mode: 'source_only' | 'synthesis_allowed';
    status: 'prepared' | 'source_preserved';
    attempts: number;
}
export declare const bundleRecordId: (kind: 'manifest' | 'original', bundleId: string) => string;
export declare const bundleIdentity: (basis: unknown) => string;
export declare function parseCompilationBundle(value: unknown): CompilationBundle;
export interface BundleOriginal {
    version: 1;
    bundleId: string;
    path: string;
    revision: string;
    byteLength: number;
    text: string;
}
export declare function parseBundleOriginal(value: unknown, b: CompilationBundle): BundleOriginal;
//# sourceMappingURL=compilation-bundle-model.d.ts.map