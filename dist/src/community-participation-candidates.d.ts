import type { FileSystemService } from './filesystem.js';
import type { ScopePrincipal } from './scope-auth.js';
import type { ScopeAccessPolicy } from './scope-access.js';
import type { ParticipationCandidate, ParticipationGoal, ParticipationTarget } from './community-participation.js';
interface CandidateContext {
    principal: ScopePrincipal;
    topics: string[];
    interests: string[];
    goals: ParticipationGoal[];
    seen: Array<ParticipationTarget & {
        handledAt: string;
        deferUntil?: string;
    }>;
    notificationPaths: string[];
    now: number;
}
export declare function matchesParticipationTopic(frontmatter: Record<string, unknown>, topic: string): boolean;
export declare function communityActivitySnapshot(fs: FileSystemService, access: ScopeAccessPolicy, principal: ScopePrincipal, rootPath: string): Promise<{
    activityRevision: string;
    frontmatter: Record<string, any>;
}>;
/** A disposable metadata projection. Only visible parents and children enter
 * groups, fingerprints, timestamps, attribution, ranking or counts.
 */
export declare function communityCandidates(fs: FileSystemService, access: ScopeAccessPolicy, context: CandidateContext): Promise<ParticipationCandidate[]>;
export {};
//# sourceMappingURL=community-participation-candidates.d.ts.map