import type { FileSystemService } from './filesystem.js';
import type { ScopeAccessPolicy } from './scope-access.js';
import type { ScopeAuthService, ScopePrincipal } from './scope-auth.js';
import type { ReferenceService } from './references.js';
import type { WorkService } from './work-service.js';
import type { AgentTaskService } from './agent-tasks.js';
import type { GitHistoryService } from './git-history.js';
import { StoryStore } from './story-store.js';
import { type StoryGuard, type StoryNote, type StoryParams, type StorySource } from './story-model.js';
export interface StoryOptions {
    readOnly?: boolean;
    assertActor?: (principal: ScopePrincipal) => Promise<void>;
    changed?: (path: string) => void;
    gitHistory?: GitHistoryService;
    readRoleplayTurn?: (source: {
        turnId: string;
        revision: string;
        noteRevision: string;
        shareable: boolean;
    }, principal: ScopePrincipal) => Promise<{
        content: string;
        guards: StoryGuard[];
        assertCurrent: () => Promise<void>;
    }>;
}
/** Shared security and current-source checks, not a model executor. */
export declare class StoryWorkspace {
    readonly fs: FileSystemService;
    readonly access: ScopeAccessPolicy;
    readonly references: ReferenceService;
    readonly auth: ScopeAuthService;
    readonly work: WorkService;
    readonly tasks: AgentTaskService;
    readonly options: StoryOptions;
    readonly store: StoryStore;
    constructor(fs: FileSystemService, access: ScopeAccessPolicy, references: ReferenceService, auth: ScopeAuthService, work: WorkService, tasks: AgentTaskService, options?: StoryOptions);
    actor(principal?: ScopePrincipal, allowReadOnly?: boolean): Promise<ScopePrincipal>;
    project(projectId: string, principal?: ScopePrincipal): Promise<StoryNote>;
    authorize(project: StoryNote, principal?: ScopePrincipal, role?: 'member' | 'owner' | 'showrunner', allowDisabled?: boolean, allowReadOnly?: boolean): Promise<StoryGuard>;
    artifact(projectId: string, artifactId: string, principal?: ScopePrincipal, branchId?: string): Promise<StoryNote>;
    projectRevision(project: StoryNote, value: unknown): void;
    sourceGuards(projectId: string, sources: StorySource[], principal?: ScopePrincipal, branchId?: string): Promise<StoryGuard[]>;
    referencesFor(projectId: string, branchId: string, value: unknown, path: string, content: string, principal?: ScopePrincipal, strictBodyLinks?: boolean): Promise<{
        paths: string[];
        guards: StoryGuard[];
    }>;
    /** Never allow a later read of the same path to replace an authored pin. */
    mergeGuards(guards: StoryGuard[]): StoryGuard[];
    private assertDependencyDomain;
    /** Fresh bounded closure, carried unchanged into every editorial write guard. */
    dependencyGuards(note: StoryNote, principal?: ScopePrincipal, extra?: StoryGuard[]): Promise<StoryGuard[]>;
    inventory(projectId: string, directory: string, principal?: ScopePrincipal, filters?: StoryParams): Promise<StoryNote[]>;
    stale(note: StoryNote, principal?: ScopePrincipal): Promise<{
        stale: boolean;
        staleSources: string[];
    }>;
    /** Bounded body continuation is revision- and actor-bound, not a second source. */
    detail(value: StoryParams, params: StoryParams, principal?: ScopePrincipal): StoryParams;
}
//# sourceMappingURL=story-workspace.d.ts.map