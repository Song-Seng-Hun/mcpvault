export interface FederationFileLimit {
    maxBytes: number;
    label?: string;
    /** Trusted logical Vault path for optional-activity authorization. Host-only
     * checkpoints omit it even when this helper supplies their confined IO. */
    ownerPath?: string;
    /** Host-only writer fencing, immediately before atomic publication. */
    beforeCommit?: () => Promise<void>;
}
export declare function readFederationFile(rootInput: string, targetInput: string, options: FederationFileLimit): Promise<string>;
export declare function ensureFederationDirectory(rootInput: string, targetInput: string): Promise<void>;
export declare function removeFederationFile(rootInput: string, targetInput: string, beforeRemove?: () => Promise<void>): Promise<void>;
export declare function writeFederationFileAtomic(rootInput: string, targetInput: string, content: string, options: FederationFileLimit): Promise<void>;
/** Display prefix is advisory; full identity digest prevents delimiter/truncation collisions. */
export declare function federationStorageName(id: string): string;
//# sourceMappingURL=public-federation-storage.d.ts.map