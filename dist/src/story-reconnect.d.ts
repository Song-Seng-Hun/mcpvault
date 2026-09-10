import type { ScopePrincipal } from './scope-auth.js';
import { type StoryGuard, type StoryNote, type StoryParams } from './story-model.js';
import type { StoryWorkspace } from './story-workspace.js';
interface Edge {
    from: string;
    to: string;
    fromGeneration: number;
    toGeneration: number;
    proposalRevision: string | null;
}
export interface WorkBinding {
    revision: string;
    generation: number;
    assigneeAccountId: string | null;
}
export interface ReconnectProof {
    task: StoryNote;
    workProject: StoryGuard;
    chain: Edge[];
    fingerprint: string;
    gitBasis: {
        head: string;
        observations: string;
    } | null;
}
export declare function storyWorkBinding(task: StoryNote): WorkBinding;
/** Same fresh proof for read-only preview and the locked mutation precondition. */
export declare function proveStoryReconnect(w: StoryWorkspace, project: StoryNote, session: StoryNote, actor: ScopePrincipal, includeGitHistory: boolean): Promise<ReconnectProof>;
/** A retry proves the persisted post-binding, not the old pre-resume chain. */
export declare function verifyStoryReconnectReplay(w: StoryWorkspace, project: StoryNote, session: StoryNote, actor: ScopePrincipal, params: StoryParams): Promise<void>;
export {};
//# sourceMappingURL=story-reconnect.d.ts.map