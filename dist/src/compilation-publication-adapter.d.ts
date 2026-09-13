import type { CompilationAdapter } from './compilation-service.js';
import type { CompilationJob, CompilationIntent } from './compilation-model.js';
import type { FileSystemService } from './filesystem.js';
import type { ScopeAccessPolicy } from './scope-access.js';
import type { ScopePrincipal } from './scope-auth.js';
import type { LlmWikiService } from './llm-wiki.js';
import type { SourceComparisonService } from './source-comparison.js';
export interface CompilationPublicationOptions {
    fs: FileSystemService;
    access: ScopeAccessPolicy;
    wiki: LlmWikiService;
    comparison: SourceComparisonService;
    authorize(accountId: string): Promise<ScopePrincipal | undefined>;
}
/** Trusted host adapter, not enabled by feature/model/client declarations. All
 * inference comes from the current agent's submitted draft; comparison is local
 * lexical-only and no provider, source capture, merge or claim promotion runs. */
export declare class CompilationPublicationAdapter implements CompilationAdapter {
    private readonly options;
    constructor(options: CompilationPublicationOptions);
    private principal;
    protect(job: Readonly<CompilationJob>, current: () => Promise<void>): Promise<void>;
    private covers;
    /** Verifies acquired source bytes and attributed no-change observations only.
     * Does not call preview/apply, generate text, or assert semantic equivalence. */
    checkObservation(job: Readonly<CompilationJob>, current: () => Promise<void>): Promise<{
        status: "partial" | "passed";
        ruleVersion: string;
    }>;
    check(job: Readonly<CompilationJob>, current: () => Promise<void>): Promise<{
        status: "partial" | "passed";
        ruleVersion: string;
    }>;
    private prepare;
    preview(job: Readonly<CompilationJob>, current: () => Promise<void>): Promise<CompilationIntent>;
    apply(job: Readonly<CompilationJob>, intent: CompilationIntent, current: () => Promise<void>): Promise<{
        success: boolean;
        created: boolean;
        path: string;
        evidencePaths: string[];
        evidence: {
            heading?: string;
            blockId?: string;
            revision?: string;
            startLine?: number;
            endLine?: number;
            quoteHash?: string;
            path: string;
        }[];
        claims?: Record<string, unknown>[];
    } & {
        revision: string;
    }>;
}
//# sourceMappingURL=compilation-publication-adapter.d.ts.map