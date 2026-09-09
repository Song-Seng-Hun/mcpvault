import type { ScopePrincipal } from './scope-auth.js';
import { type StoryParams, type StoryNote } from './story-model.js';
import type { StoryWorkspace } from './story-workspace.js';
export declare function projectView(note: StoryNote): StoryParams;
export declare class StoryProjects {
    private readonly w;
    constructor(w: StoryWorkspace);
    execute(params: StoryParams, principal?: ScopePrincipal): Promise<StoryParams>;
    sequence(params: StoryParams, principal?: ScopePrincipal): Promise<StoryParams>;
}
//# sourceMappingURL=story-projects.d.ts.map