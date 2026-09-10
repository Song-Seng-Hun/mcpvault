import { PathFilter } from './pathfilter.js';
import type { CommitChangesResult, InitializeRevisionResult, RevisionDiffResult, RevisionEntry, RevisionStatus } from './types.js';
export interface GitTaskHistory {
    head: string;
    observations: Array<{
        commit: string;
        blob: string;
        content: string;
    }>;
}
interface CommitChangesParams {
    reason: string;
    paths?: string[];
    authorName?: string;
    authorEmail?: string;
}
export declare class GitHistoryService {
    private readonly pathFilter;
    private readonly vaultPath;
    private statusCache;
    private statusPromise;
    private mutationTail;
    constructor(vaultPath: string, pathFilter?: PathFilter);
    /** Explicit opt-in only. Observations retain first-parent newest-first order,
     * including older changed-path states (not merely the newest receipt/event).
     * They are raw historical states, never evidence
     * that an old receipt describes an accepted handoff; the authenticated caller
     * must interpret each state and retain its own current-task revision guards. */
    taskHandoffHistory(pathInput: string, canRead: (path: string) => boolean): Promise<GitTaskHistory>;
    private readTaskGit;
    private runGit;
    private pathsEqual;
    private repoRoot;
    private requireRepo;
    private clearStatusCache;
    private withMutation;
    private normalizeVaultPath;
    private parseStatus;
    private pendingChanges;
    private literalPathspec;
    private rejectExecutableFilters;
    private validateRevision;
    resolveRevision(input: string): Promise<string>;
    initialize(): Promise<InitializeRevisionResult>;
    private initializeInternal;
    status(): Promise<RevisionStatus>;
    private readStatus;
    commitChanges(params: CommitChangesParams): Promise<CommitChangesResult>;
    private commitChangesInternal;
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