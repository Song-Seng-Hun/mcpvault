export interface FederationFileLimit {
    maxBytes: number;
    label?: string;
}
export declare function readFederationFile(rootInput: string, targetInput: string, options: FederationFileLimit): Promise<string>;
export declare function ensureFederationDirectory(rootInput: string, targetInput: string): Promise<void>;
export declare function removeFederationFile(rootInput: string, targetInput: string): Promise<void>;
export declare function writeFederationFileAtomic(rootInput: string, targetInput: string, content: string, options: FederationFileLimit): Promise<void>;
/** Display prefix is advisory; full identity digest prevents delimiter/truncation collisions. */
export declare function federationStorageName(id: string): string;
//# sourceMappingURL=public-federation-storage.d.ts.map