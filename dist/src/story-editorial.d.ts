import type { ScopePrincipal } from './scope-auth.js';
import { type StoryParams } from './story-model.js';
import type { StoryWorkspace } from './story-workspace.js';
export declare class StoryEditorial {
    readonly w: StoryWorkspace;
    constructor(w: StoryWorkspace);
    private visualGuards;
    review(params: StoryParams, principal?: ScopePrincipal): Promise<StoryParams>;
    adopt(params: StoryParams, principal?: ScopePrincipal): Promise<StoryParams>;
}
//# sourceMappingURL=story-editorial.d.ts.map