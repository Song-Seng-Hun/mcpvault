import type { FileSystemService } from './filesystem.js';
import type { ScopeAccessPolicy } from './scope-access.js';
import type { ScopePrincipal, ScopeAuthService } from './scope-auth.js';
import { type SkillEvaluationProfile } from './skill-evaluation.js';
import { SkillEvolutionStore, type SkillData } from './skill-evolution-store.js';
import type { RetrievalHit } from './retrieval-service.js';
/** Supplied by host code only. No endpoint loads code, keys or configuration paths. */
export interface SkillEvolutionHost {
    enabled: boolean;
    attestationKey: string;
    approverAccounts: readonly string[];
    profiles: readonly SkillEvaluationProfile[];
}
type Params = Record<string, any> & {
    principal?: ScopePrincipal;
};
/** Skill evolution is opt-in procedural knowledge, not an executor or scheduler. */
export declare class SkillEvolutionService {
    private readonly fs;
    private readonly access;
    private readonly auth;
    private readonly host?;
    private readonly options;
    readonly store: SkillEvolutionStore;
    constructor(fs: FileSystemService, access: ScopeAccessPolicy, auth: ScopeAuthService, host?: SkillEvolutionHost | undefined, options?: {
        assertActor?: (principal: ScopePrincipal) => Promise<void>;
        readOnly?: boolean;
    });
    get enabled(): boolean;
    private transaction;
    private configured;
    private actor;
    private approver;
    private profile;
    private request;
    private requestId;
    private replay;
    private result;
    private save;
    private source;
    private basis;
    resolve(p: Params): Promise<SkillData>;
    /** Filter audit records before ranking, independent of forged note properties. */
    discoveryAllowed(path: string): boolean;
    /** Resolve only skills already found by this query, never scan the library. */
    projectDiscovery(hits: RetrievalHit[], principal?: ScopePrincipal, admitted?: (path: string) => boolean): Promise<RetrievalHit[]>;
    experience(p: Params): Promise<SkillData>;
    private experienceWrite;
    candidate(p: Params): Promise<SkillData>;
    private candidateOperation;
    private listCandidates;
    nextAction(p: {
        principal: ScopePrincipal;
        skillId: string;
    }): Promise<{
        endpointId: string;
        arguments: Record<string, unknown>;
    } | undefined>;
    private evaluationBasis;
    evaluate(p: Params): Promise<SkillData>;
    private evaluateOperation;
    private promotionPreview;
    promote(p: Params): Promise<SkillData>;
    private promoteOperation;
    rollback(p: Params): Promise<SkillData>;
    private rollbackOperation;
}
export {};
//# sourceMappingURL=skill-evolution.d.ts.map