export declare const GUIDANCE_ROOT = "_wiki/Interface";
export interface GuidanceSettings {
    root: typeof GUIDANCE_ROOT;
    editors: string[];
}
export interface GuidanceDefinition {
    id: string;
    kind: 'prose' | 'error';
    template: string;
    parts?: string[];
    sources: Array<{
        file: string;
        line: number;
    }>;
    binding: 'call' | 'projection' | 'connection' | 'pending';
}
export declare const guidanceHash: (text: string) => string;
export declare function guidanceSourceRevision(definition: GuidanceDefinition): string;
export declare function serializeGuidanceNote(definition: GuidanceDefinition, body?: string): string;
export type GuidanceStatus = 'disabled' | 'missing' | 'invalid' | 'source_conflict' | 'default' | 'override';
export interface GuidanceInspection {
    id: string;
    path: string;
    status: GuidanceStatus;
    sourceRevision: string;
    revision?: string;
    body?: string;
}
export declare class GuidanceCatalog {
    private readonly vaultPath;
    private readonly settings;
    readonly definitions: readonly GuidanceDefinition[];
    private readonly canServe;
    private readonly byId;
    private readonly byDefault;
    private readonly frontmatter;
    constructor(vaultPath: string, settings: () => GuidanceSettings | undefined, definitions?: readonly GuidanceDefinition[], canServe?: (path: string) => boolean);
    definition(id: string): GuidanceDefinition | undefined;
    enabled(): boolean;
    isManagedPath(path: string): boolean;
    pathFor(id: string): string;
    /** Host settings and catalog IDs, never editable Properties, determine identity. */
    noticeEntry(id: string): {
        id: string;
        path: string;
        title: string;
        priority: number;
        topics: string[];
        editors: string[];
    } | undefined;
    checkedPath(path: string): string;
    inspect(id: string): GuidanceInspection;
    validateAmendment(id: string, body: string, sourceRevision: unknown): Record<string, string>;
    list(args: {
        query?: string;
        limit?: number;
        maxChars?: number;
        cursor?: string;
        sourceId?: string;
        offset?: number;
        sourceRevision?: string;
    }, canRead: (path: string) => boolean): {
        id: string;
        sourceRevision: string;
        projection: string;
        content: string;
        offset: number;
        truncated: boolean;
        nextAction: {
            endpointId: string;
            arguments: {
                sourceId: string;
                sourceRevision: string;
                offset: number;
                maxChars: number;
            };
        };
    } | {
        entries: unknown[];
        truncated: boolean;
        cursor?: string;
        warning: string;
    };
    run<T>(operation: () => T): T;
}
//# sourceMappingURL=guidance-catalog.d.ts.map