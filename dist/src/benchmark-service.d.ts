import type { FileSystemService } from './filesystem.js';
import type { ScopePrincipal } from './scope-auth.js';
import { ScopeAccessPolicy } from './scope-access.js';
import { PathFilter } from './pathfilter.js';
import type { EconomyLedger } from './economy-ledger.js';
import { type BenchmarkAwardProof, type BenchmarkIssuanceProgram, type EconomyState } from './economy-model.js';
import { type BenchmarkIntegrity } from './benchmark-host.js';
import { type BenchmarkInitiativeHost } from './benchmark-initiative.js';
export { runBenchmarkInitiative } from './benchmark-initiative.js';
import { type BenchmarkDefinition, type BenchmarkProfile } from './benchmark-model.js';
export interface BenchmarkOptions {
    enabled: boolean;
    definitions: readonly BenchmarkDefinition[];
    accountProfiles: () => Promise<Record<string, BenchmarkProfile>>;
    /** Current authentication/moderation backend, not the host approval list. */
    accountAvailable: (accountId: string) => Promise<boolean>;
    /** Called again at every durable boundary. Never trust principal model labels. */
    assertActor: (principal: ScopePrincipal) => Promise<ScopePrincipal>;
    assertHumanOperator: (actor: string) => Promise<void>;
    answerReader: (definitionId: string) => Promise<unknown>;
    integrity: BenchmarkIntegrity;
    ledger?: EconomyLedger;
    access?: ScopeAccessPolicy;
    pathFilter?: PathFilter;
    now?: () => Date;
}
export type BenchmarkOperation = 'list' | 'read' | 'submit' | 'review' | 'finalize';
export type BenchmarkHostOperation = 'inspect' | 'open' | 'finalize' | 'close' | 'cancel' | 'project' | 'evidence';
/** Fixed managed private Markdown paths; never expose records through generic notes.
 * Host opening is deliberately separate from the agent operation dispatcher. */
export declare class BenchmarkService {
    private readonly fs;
    private readonly options;
    private readonly definitions;
    private readonly access;
    private readonly filter;
    constructor(fs: FileSystemService, options: BenchmarkOptions);
    static issuanceProgram(definition: BenchmarkDefinition): BenchmarkIssuanceProgram;
    private enabled;
    private definition;
    private path;
    private now;
    private route;
    private profiles;
    private actor;
    private sources;
    private version;
    private load;
    private save;
    private profilesCurrent;
    open(id: string, actor: string, params: {
        expectedRevision: string;
        requestId: string;
    }): Promise<Record<string, unknown>>;
    /** Host-only global absence proof over configured selected problems and their
     * existing sealed records. Never a participant list, corpus scan or index. */
    initiativeStatus(operator: string): Promise<{
        state: 'disabled' | 'pending_approval' | 'active' | 'empty' | 'unknown';
    }>;
    /** Host integration entrypoint; the current runtime's host authentication and
     * global state are bound here, never supplied by an agent endpoint argument. */
    runInitiative(operator: string, trigger: 'session_start' | 'work_completion' | 'approved_heartbeat', host?: BenchmarkInitiativeHost): Promise<Record<string, unknown>>;
    private budget;
    private bounded;
    private chunk;
    private freshness;
    private read;
    private decide;
    private proof;
    /** Host-only receipt adapter called INSIDE ledger serialization. It must not
     * snapshot/transact the same ledger, which would deadlock its writer queue. */
    validateAwardProof(proof: BenchmarkAwardProof, state: EconomyState): Promise<void>;
    private pay;
    private assertSettlement;
    /** CLI/host-only pathway. Never map these operations to agent endpoints. */
    executeHost(op: BenchmarkHostOperation, params: Record<string, unknown>, operator: string): Promise<Record<string, any>>;
    private resultEvidence;
    execute(op: string, params: Record<string, unknown>, principal?: ScopePrincipal): Promise<Record<string, any>>;
    /** Opt-in suggestion only: no enrollment, model call, timer or mutation. */
    pulse(principal: ScopePrincipal): Promise<{
        endpointId: string;
        arguments: Record<string, unknown>;
        reason: string;
    } | undefined>;
}
//# sourceMappingURL=benchmark-service.d.ts.map