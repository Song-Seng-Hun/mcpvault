export declare const isUNCPath: (path: string) => boolean;
export declare const pathInside: (root: string, path: string) => boolean;
/** Inspect lexical ancestors BEFORE realpath can hide a junction. Host-provisioned
 * roots must exist; device namespaces and dot segments are not storage aliases. */
export declare function canonicalHostPath(path: string, local: boolean, file?: boolean): Promise<string>;
export declare function validateHostStorage(options: {
    vaultPath: string;
    hostPath: string;
}): Promise<{
    vaultPath: string;
    hostPath: string;
}>;
export interface HostFileLimit {
    maxBytes: number;
    label?: string;
    /** Host-only writer fencing, immediately before atomic publication. */
    beforeCommit?: () => Promise<void>;
}
export declare function readHostFile(rootInput: string, targetInput: string, options: HostFileLimit): Promise<string>;
export declare function removeHostFile(rootInput: string, targetInput: string, beforeRemove?: () => Promise<void>): Promise<void>;
export declare function writeHostFileAtomic(rootInput: string, targetInput: string, content: string, options: HostFileLimit): Promise<void>;
//# sourceMappingURL=host-storage.d.ts.map