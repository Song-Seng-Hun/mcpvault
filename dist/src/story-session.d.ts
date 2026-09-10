import type { ScopePrincipal } from './scope-auth.js';
import type { FileSystemService } from './filesystem.js';
import type { ParsedNote } from './types.js';
import { type StoryParams } from './story-model.js';
import type { StoryWorkspace } from './story-workspace.js';
/** Durable host-driven coordination. Roles never instantiate or impersonate agents. */
export declare class StorySessions {
    readonly w: StoryWorkspace;
    constructor(w: StoryWorkspace);
    private view;
    execute(params: StoryParams, principal?: ScopePrincipal): Promise<StoryParams>;
}
/** Read-only Work handoff from existing session records, never Work approval. */
export declare function storyWorkResults(fs: FileSystemService, taskId: string, projectId: string, readVisible: (path: string) => Promise<ParsedNote>, admitted: (path: string) => boolean): Promise<StoryParams[]>;
//# sourceMappingURL=story-session.d.ts.map