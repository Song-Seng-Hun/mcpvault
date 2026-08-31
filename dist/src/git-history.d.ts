import { PathFilter } from './pathfilter.js';
import type { CommitChangesResult, InitializeRevisionResult, RevisionDiffResult, RevisionEntry, RevisionStatus } from './types.js';
interface CommitChangesParams {
    reason: string;
    paths?: string[];
    authorName?: string;
    authorEmail?: string;
}
export declare class GitHistoryService {
    private readonly pathFilter;
    private readonly vaultPath;
    constructor(vaultPath: string, pathFilter?: PathFilter);
    private runGit;
    private pathsEqual;
    private repoRoot;
    private requireRepo;
    private normalizeVaultPath;
    private parseStatus;
    private pendingChanges;
    private literalPathspec;
    private rejectExecutableFilters;
    private validateRevision;
    resolveRevision(input: string): Promise<string>;
    initialize(): Promise<InitializeRevisionResult>;
    status(): Promise<RevisionStatus>;
    commitChanges(params: CommitChangesParams): Promise<CommitChangesResult>;
    noteHistory(pathInput: string, limit?: number): Promise<RevisionEntry[]>;
    compareNoteRevisions(pathInput: string, fromInput: string, toInput?: string, maxChars?: number): Promise<RevisionDiffResult>;
    fileAtRevision(pathInput: string, revisionInput: string): Promise<{
        path: string;
        revision: string;
        content: string;
    }>;
    hasPendingChange(pathInput: string): Promise<boolean>;
}
export {};
//# sourceMappingURL=git-history.d.ts.map