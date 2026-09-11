import type { FileSystemService } from './filesystem.js';
import type { ScopePrincipal } from './scope-auth.js';
import type { ScopeAccessPolicy } from './scope-access.js';
import type { ReferenceService } from './references.js';
import type { RetrievalService } from './retrieval-service.js';
import { RoleplayStore } from './roleplay-store.js';
interface Options {
    assertActor: (principal: ScopePrincipal) => Promise<void>;
    validateQuestBinding?: (questId: string, principal: ScopePrincipal) => Promise<void>;
    changed?: (path: string) => void;
    retrieval?: RetrievalService;
}
/** MCP and chat use this service; neither adapter is an alternate game authority. */
export declare class RoleplayService {
    private readonly fs;
    private readonly access;
    private readonly references;
    private readonly store;
    private readonly options;
    private readonly paths;
    constructor(fs: FileSystemService, access: ScopeAccessPolicy, references: ReferenceService, store: RoleplayStore | undefined, options: Options);
    private visible;
    private current;
    private assertRoom;
    /** Explicit host adapter for an existing Story draft, never a game mutation. */
    storyTurn(source: {
        turnId: string;
        revision: string;
        noteRevision: string;
        shareable: boolean;
    }, principal: ScopePrincipal): Promise<{
        content: string;
        guards: {
            path: string;
            expectedRevision: string;
        }[];
        assertCurrent: () => Promise<void>;
    }>;
    private captureGuards;
    private validateEvolutionSources;
    execute(endpoint: string, params: Record<string, any>, principal?: ScopePrincipal): Promise<Record<string, any>>;
    private executeCoordinated;
    private read;
}
export {};
//# sourceMappingURL=roleplay-service.d.ts.map