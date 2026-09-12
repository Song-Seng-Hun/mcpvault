import type { ScopePrincipal } from './scope-auth.js';
/** Protected source metadata, never supplied as a read caller's claimed rights.
 * Folder placement alone grants nothing: recursive rules are explicit policy. */
export interface DocumentAccessRule {
    path: string;
    recursive?: boolean;
    confidential?: boolean;
    realmId?: string;
    departmentIds?: readonly string[];
    accountIds?: readonly string[];
    derivedFrom?: readonly string[];
}
export interface DocumentAuthorityOptions {
    documentRules?: () => readonly DocumentAccessRule[];
    /** Trusted host execution verifier, not a JSON option or model/provider label. */
    localInferenceAllowed?: (principal: ScopePrincipal) => boolean;
}
export declare function documentPolicyPath(value: unknown): string;
/** Disposable compiled lookup. Exact path/prefix/ancestry lookups replace
 * repeated whole-policy scans; all constraints combine by intersection. */
export declare class DocumentAuthority {
    readonly fingerprint: string;
    readonly rules: readonly DocumentAccessRule[];
    private readonly exact;
    private readonly prefixes;
    private readonly resolved;
    private readonly effective;
    private readonly sourceFamilies;
    constructor(input: readonly DocumentAccessRule[]);
    /** Apply source-family equivalence to every ancestor. Equivalence itself is
     * not a derivation cycle; explicit ancestry cycles were validated above. */
    effectiveConstraints(pathInput: string): readonly DocumentAccessRule[];
    constraints(pathInput: string, visiting?: Set<string>): readonly DocumentAccessRule[];
    canRead(path: string, principal?: ScopePrincipal, localInferenceAllowed?: (principal: ScopePrincipal) => boolean): boolean;
    canFlow(container: string, source: string): boolean;
}
export declare function documentAuthorityReader(options: DocumentAuthorityOptions): () => DocumentAuthority | undefined;
//# sourceMappingURL=document-authority.d.ts.map