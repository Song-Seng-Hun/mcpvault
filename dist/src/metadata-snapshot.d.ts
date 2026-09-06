export declare const METADATA_SNAPSHOT_MAX_ENTRIES = 1000000;
export declare const METADATA_SNAPSHOT_MAX_BYTES: number;
export interface MetadataSnapshotEntry {
    path: string;
    frontmatter: Record<string, any>;
    revision: string;
    size: number;
    mtimeMs: number;
}
/** Serialize synchronously before IO so mutable index rows cannot change the
 * prepared snapshot. Limits may narrow, never broaden, production ceilings.
 * One giant JSON string still needs serialization; this is not a heap ceiling. */
export declare function encodeMetadataSnapshot(entries: readonly MetadataSnapshotEntry[], limits?: {
    maxBytes?: number;
    maxEntries?: number;
}): Buffer;
export declare function decodeMetadataSnapshot(buffer: Buffer): MetadataSnapshotEntry[] | undefined;
//# sourceMappingURL=metadata-snapshot.d.ts.map