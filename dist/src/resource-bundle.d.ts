export declare const RESOURCE_BUNDLE_ROOT = "Community/_sources/resources";
export interface ResourceBundleEntry {
    path: string;
    status: 'available' | 'rejected';
    sha256?: string;
    byteLength?: number;
    mediaType?: string;
    reason?: string;
}
export interface ResourceBundleManifest {
    version: 1;
    id: string;
    origin: string;
    sourceVersion: string;
    license: string;
    licenseFile: string;
    entries: ResourceBundleEntry[];
    execution: 'never';
}
export declare const resourceBundleHash: (manifest: ResourceBundleManifest) => string;
export declare function safeResourceRelative(path: string): boolean;
export declare function resourceBundleLocation(path: string): {
    root: string;
    relative: string;
    hash: string;
} | undefined;
export declare function parseResourceBundleManifest(raw: string, hash: string): ResourceBundleManifest;
export declare function renderResourceBundleManifest(manifest: ResourceBundleManifest): string;
/** Imports are host-only immutable snapshots, including their ancestor moves. */
export declare function assertResourceBundleMutationBoundary(path: string): void;
//# sourceMappingURL=resource-bundle.d.ts.map