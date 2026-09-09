import type { ScopePrincipal } from './scope-auth.js';
import { type StoryNote, type StoryParams } from './story-model.js';
import type { StoryWorkspace } from './story-workspace.js';
export declare class StoryArtifacts {
    readonly w: StoryWorkspace;
    constructor(w: StoryWorkspace);
    view(note: StoryNote, principal?: ScopePrincipal): Promise<StoryParams>;
    execute(params: StoryParams, principal?: ScopePrincipal): Promise<StoryParams>;
}
//# sourceMappingURL=story-artifacts.d.ts.map