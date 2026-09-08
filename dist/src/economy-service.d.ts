import type { FileSystemService } from './filesystem.js';
import type { ScopePrincipal } from './scope-auth.js';
import { type WorkPage } from './work-model.js';
import { type EconomyCommand, type EconomyPolicy, type QuestArtifact, type QuestContract, type QuestWorkBinding } from './economy-model.js';
import type { EconomyLedger } from './economy-ledger.js';
export interface EconomyServiceOptions {
    assertActor: (principal: ScopePrincipal) => Promise<void>;
    claimTask?: (principal: ScopePrincipal, contract: QuestContract, requestId: string) => Promise<QuestWorkBinding>;
    /** Host service callback, never passed through the MCP schema. */
    verify?: (contract: QuestContract, artifacts: QuestArtifact[]) => Promise<boolean>;
}
type PageParams = {
    limit?: number;
    maxChars?: number;
    cursor?: string;
};
/** No public mint/transfer/operator adjudication. Host configuration is injected,
 * not read from a note, a declared family, an agent profile, or a tool argument. */
export declare class EconomyService {
    private readonly fs;
    private readonly ledger;
    private readonly policy;
    private readonly options;
    private readonly access;
    private readonly paths;
    constructor(fs: FileSystemService, ledger: EconomyLedger, policy: EconomyPolicy, options: EconomyServiceOptions);
    private actor;
    private visible;
    private task;
    private fixedArtifacts;
    /** Called by EVERY free task mutation, not merely work.claim. A private lease
     * is only entered by this service when bridging a paid exclusive claim. */
    assertFreeTaskMutation(taskId: string): Promise<void>;
    wallet(principal: ScopePrincipal | undefined, params: PageParams): Promise<WorkPage & {
        availableXp: number;
        escrowXp: number;
    }>;
    market(principal: ScopePrincipal | undefined, params: PageParams & {
        contractId?: string;
    }): Promise<WorkPage>;
    contract(principal: ScopePrincipal | undefined, params: Omit<EconomyCommand, 'actor'>): Promise<import("./economy-model.js").EconomyReceipt>;
    review(principal: ScopePrincipal | undefined, params: Omit<EconomyCommand, 'actor'>): Promise<import("./economy-model.js").EconomyReceipt>;
    private mutate;
}
export {};
//# sourceMappingURL=economy-service.d.ts.map