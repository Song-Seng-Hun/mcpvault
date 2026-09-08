export declare const MEMORY_ROLES: readonly ['core', 'episodic', 'semantic', 'procedural', 'resource'];
export type MemoryRole = typeof MEMORY_ROLES[number];
export interface MemoryReference {
    path: string;
    revision?: string;
    block_id?: string;
}
export interface MemoryEntry {
    block_id?: string;
    role: MemoryRole;
    state?: 'active' | 'archived';
    observed_at?: string;
    valid_from?: string;
    valid_until?: string;
    retrieval_cues?: string[];
    use_when?: string;
    basis?: MemoryReference[];
    corrects?: MemoryReference[];
}
/** The authoring schema shares role/locator constraints with final-file validation. */
export declare function memoryEntrySchema(): {
    type: string;
    additionalProperties: boolean;
    required: string[];
    properties: {
        block_id: {
            type: string;
            pattern: string;
            description: "Anchor ^id on the actual experience paragraph/list in content, outside fences. A standalone anchor binds only the immediately preceding block, not the whole journal. Verify the recalled excerpt after writing.";
        };
        role: {
            type: string;
            enum: ("core" | "episodic" | "procedural" | "resource" | "semantic")[];
        };
        state: {
            type: string;
            enum: string[];
        };
        observed_at: {
            type: string;
            description: "Event date YYYY-MM-DD or known ISO timestamp; do not invent precision.";
        };
        valid_from: {
            type: string;
        };
        valid_until: {
            type: string;
        };
        retrieval_cues: {
            type: string;
            maxItems: number;
            items: {
                type: string;
                maxLength: number;
            };
        };
        use_when: {
            type: string;
            maxLength: number;
        };
        basis: {
            type: string;
            maxItems: number;
            items: {
                type: string;
                additionalProperties: boolean;
                required: string[];
                properties: {
                    path: {
                        type: string;
                        maxLength: number;
                        description: "Exact .md Vault path or authorized scope URI; never a description of an assumption.";
                    };
                    revision: {
                        type: string;
                        pattern: string;
                    };
                    block_id: {
                        type: string;
                        pattern: string;
                    };
                };
            };
            description: "Array of exact supporting source references; pin each reviewed revision.";
        };
        corrects: {
            type: string;
            maxItems: number;
            items: {
                type: string;
                additionalProperties: boolean;
                required: string[];
                properties: {
                    path: {
                        type: string;
                        maxLength: number;
                        description: "Exact .md Vault path or authorized scope URI; never a description of an assumption.";
                    };
                    revision: {
                        type: string;
                        pattern: string;
                    };
                    block_id: {
                        type: string;
                        pattern: string;
                    };
                };
            };
            description: "Array of old memory references, not prose. Put failed assumptions in Markdown.";
        };
    };
};
export declare function memoryDate(value: unknown, name: string): void;
/** Exact vault paths only. No aliases, host paths, URL fetches or inferred owners. */
export declare function memoryReferencePath(value: string): string;
export declare function memoryReferenceAllowed(owner: string, source: string): boolean;
export declare function memoryEntries(fm: Record<string, any>): MemoryEntry[];
/** Validate the final serialized file, including raw-YAML and patch writers. */
export declare function assertMemoryContent(raw: string, path: string): void;
//# sourceMappingURL=memory-contract.d.ts.map