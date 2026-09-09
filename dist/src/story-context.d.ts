import type { ScopePrincipal } from './scope-auth.js';
import { type StoryParams } from './story-model.js';
import type { StoryWorkspace } from './story-workspace.js';
export declare class StoryContext {
    readonly w: StoryWorkspace;
    constructor(w: StoryWorkspace);
    read(params: StoryParams, principal?: ScopePrincipal): Promise<StoryParams>;
}
//# sourceMappingURL=story-context.d.ts.map