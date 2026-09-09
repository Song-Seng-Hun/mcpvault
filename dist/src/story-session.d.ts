import type { ScopePrincipal } from './scope-auth.js';
import { type StoryParams } from './story-model.js';
import type { StoryWorkspace } from './story-workspace.js';
/** Durable host-driven coordination. Roles never instantiate or impersonate agents. */
export declare class StorySessions {
    readonly w: StoryWorkspace;
    constructor(w: StoryWorkspace);
    private view;
    execute(params: StoryParams, principal?: ScopePrincipal): Promise<StoryParams>;
}
//# sourceMappingURL=story-session.d.ts.map