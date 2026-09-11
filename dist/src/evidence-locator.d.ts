export interface EvidenceLocator {
    revision?: string;
    heading?: string;
    blockId?: string;
    startLine?: number;
    endLine?: number;
    quoteHash?: string;
}
export interface EvidenceResolution {
    valid: boolean;
    specified: boolean;
    issue?: string;
    preferredLine?: number;
    startLine?: number;
    endLine?: number;
}
/** Resolve syntax against this exact body, never semantic truth or access.
 * One sequential pass, constant scan state: no whole-body split or literal mask.
 * Coordinates and quote hashes preserve original body newlines (including CRLF).
 */
export declare function resolveEvidenceLocator(content: string, locator: EvidenceLocator, revision?: string): EvidenceResolution;
//# sourceMappingURL=evidence-locator.d.ts.map