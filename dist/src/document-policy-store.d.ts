import { type DocumentAccessRule } from './document-authority.js';
export declare const DOCUMENT_POLICY_PATH = "_wiki/_policies/documents.md";
/** Authoritative Markdown metadata, deliberately outside the generic note API.
 * No raw original is changed and no request can claim or downgrade its rules.
 * Each request refreshes before work and before returning, including on NAS.
 * Compiled definitions are reused only for exactly the same policy bytes. */
export declare class DocumentPolicyStore {
    private readonly vault;
    private definition;
    private digest;
    private seen;
    private ready;
    private queue;
    private content;
    constructor(vault: string);
    rules(): readonly DocumentAccessRule[];
    revision(): string | 'missing';
    refresh(): Promise<void>;
    private read;
    /** Trusted writer: can only ADD inherited restrictions, never relax or edit
     * source classifications. Persist before writing a derivative's body. A failed
     * later write may leave conservative metadata, never a public partial body. */
    inherit(targetInput: string, sourceInputs: readonly string[], expectedRevision: string): Promise<void>;
    /** Persist restrictions and a directory-wide hold before any chapter bytes.
     * A published/reused root is not silently adopted as a new bundle. */
    beginPublication(root: string, sourceInputs: readonly string[], owner: string, expectedRevision: string): Promise<void>;
    /** The publication owner supplies a reread-verified manifest before calling.
     * This removes only its hold; current source/audience constraints survive. */
    finishPublication(root: string, owner: string, expectedRevision: string): Promise<void>;
    /** Re-hide only the exact released rule pinned by the publication journal.
     * The caller still verifies ownership, outputs and current authorization. */
    holdPublished(root: string, owner: string, released: DocumentAccessRule, expectedRevision: string): Promise<void>;
    private updateRules;
}
//# sourceMappingURL=document-policy-store.d.ts.map