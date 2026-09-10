import { type SkillHostEntry } from './skill-library.js';
import { type ResourceBundleManifest } from './resource-bundle.js';
export interface ResourceBundleSource {
    manifest: ResourceBundleManifest;
    files: Array<{
        path: string;
        bytes: Buffer;
    }>;
}
export interface ResourceBundleHostEntry extends SkillHostEntry {
    publishResourcesToCommunity: true;
}
export declare function readSkillResourceBundle(entry: ResourceBundleHostEntry): Promise<ResourceBundleSource>;
export declare function previewResourceBundle(vault: string, source: ResourceBundleSource): Promise<{
    path: string;
    revision: string;
    status: "create" | "unchanged";
    files: number;
    fingerprint: string;
}>;
export declare function applyResourceBundle(vault: string, source: ResourceBundleSource, fingerprint: string): Promise<{
    path: string;
    revision: string;
    status: "create" | "unchanged";
    files: number;
    fingerprint: string;
} | {
    path: string;
    revision: string;
    files: number;
    fingerprint: string;
    status: 'created';
}>;
//# sourceMappingURL=resource-bundle-host.d.ts.map