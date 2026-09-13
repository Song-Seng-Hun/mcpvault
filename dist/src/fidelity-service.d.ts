import type { FileSystemService } from './filesystem.js';
import type { ScopeAccessPolicy } from './scope-access.js';
import type { ScopePrincipal } from './scope-auth.js';
import { type EvidenceLocator } from './evidence-locator.js';
export interface FidelityFact {
    id: string;
    kind: 'condition' | 'negation' | 'counterexample' | 'contradiction' | 'number' | 'date' | 'version' | 'quote';
    sourceLocator: EvidenceLocator;
    outputLocator?: EvidenceLocator;
    comparisonMode: 'exact' | 'translation' | 'calculation' | 'ambiguous_unit';
    semanticJudgment: 'preserved' | 'missing' | 'uncertain';
}
export interface FidelityCheckParams {
    sourcePath: string;
    outputPath: string;
    sourceRevision: string;
    outputRevision: string;
    facts: FidelityFact[];
    maxChars?: number;
    principal?: ScopePrincipal;
}
export declare class FidelityService {
    private readonly fs;
    private readonly access;
    constructor(fs: FileSystemService, access: ScopeAccessPolicy);
    /** Read-only, bounded comparison. Agent reports are attributed, never upgraded
     * to server-certified semantic truth or a grant to publish derived content. */
    check(params: FidelityCheckParams, assertCurrent?: () => Promise<void>): Promise<any>;
}
//# sourceMappingURL=fidelity-service.d.ts.map