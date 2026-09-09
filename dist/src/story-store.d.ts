import type { FileSystemService } from './filesystem.js';
import type { ScopeAccessPolicy } from './scope-access.js';
import type { ScopePrincipal } from './scope-auth.js';
import { type StoryGuard, type StoryNote, type StoryParams } from './story-model.js';
interface StoryRequest {
    id: string;
    actor: string;
    action: string;
    payload: string;
}
/** Markdown owns both content and bounded retry receipts. No second database. */
export declare class StoryStore {
    readonly fs: FileSystemService;
    readonly access: ScopeAccessPolicy;
    constructor(fs: FileSystemService, access: ScopeAccessPolicy);
    read(path: string, principal?: ScopePrincipal, optional?: boolean): Promise<StoryNote | undefined>;
    request(action: string, params: StoryParams, principal: ScopePrincipal): StoryRequest;
    retry(note: StoryNote | undefined, request: StoryRequest): StoryParams | undefined;
    write(path: string, fm: StoryParams, content: string, expectedRevision: unknown, request: StoryRequest, result: StoryParams, guards: StoryGuard[], assertAccess: () => Promise<void>, prior?: StoryNote): Promise<StoryParams>;
    assertCurrent(guards: StoryGuard[], principal?: ScopePrincipal): Promise<void>;
}
export {};
//# sourceMappingURL=story-store.d.ts.map