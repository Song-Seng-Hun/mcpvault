export type SourceDerivation = {
    path: string;
    revision: string;
    relation: 'quotation' | 'adaptation' | 'republication';
};
export type SourceOriginNode = {
    path: string;
    revision: string;
    workId?: string;
    derivations: unknown;
    integrity: boolean;
};
export type SourceOriginTrace = {
    status: 'shared_origin_observed' | 'separately_recorded_origins' | 'no_sources' | 'partial';
    groups: Array<{
        sourcePaths: string[];
        sharedOrigins: Array<{
            path: string;
            revision: string;
            workId?: string;
        }>;
    }>;
    unresolved: boolean;
    truncated: boolean;
    cautions: string[];
    notice: string;
};
export declare function normalizeSourceDerivations(value: unknown): SourceDerivation[];
export declare function traceSourceOrigins(seedPaths: string[], load: (path: string) => Promise<SourceOriginNode | undefined>): Promise<SourceOriginTrace>;
//# sourceMappingURL=source-provenance-model.d.ts.map