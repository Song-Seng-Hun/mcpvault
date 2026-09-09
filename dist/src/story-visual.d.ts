import type { ScopePrincipal } from './scope-auth.js';
import { type StoryGuard, type StoryNote, type StoryParams, type StorySource } from './story-model.js';
import type { StoryWorkspace } from './story-workspace.js';
/** Shared by the public artifact path and visual proposal creation. */
export declare function validateVisualArtifact(w: StoryWorkspace, project: StoryNote, branchId: string, kind: string, data: StoryParams, content: string, sources: StorySource[], principal: ScopePrincipal): Promise<StoryGuard[]>;
/** Revalidate typed data after host edits, without impersonating its author or
 * requiring the project to remain forever at the creation-time revision. */
export declare function validatePersistedVisualArtifact(w: StoryWorkspace, project: StoryNote, artifact: StoryNote, principal: ScopePrincipal): Promise<StoryGuard[]>;
/** No extraction, model execution, automatic scene replacement, or Canvas writes. */
export declare class StoryVisual {
    readonly w: StoryWorkspace;
    constructor(w: StoryWorkspace);
    execute(params: StoryParams, principal?: ScopePrincipal): Promise<StoryParams>;
}
//# sourceMappingURL=story-visual.d.ts.map