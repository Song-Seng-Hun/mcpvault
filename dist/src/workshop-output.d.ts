import type { FileSystemService } from './filesystem.js';
import type { ScopePrincipal } from './scope-auth.js';
import type { ParsedNote } from './types.js';
export interface WorkshopOutputReceipt {
    workshopPath: string;
    outputId: string;
    payloadFingerprint: string;
    actor: string;
}
export interface WorkshopOutputInput {
    outputId: string;
    type: 'decision' | 'task';
    kind: string;
    path: string;
    title: string;
    context?: string;
    decision?: string;
    description?: string;
    alternatives: string[];
    consequences: string[];
    minority: string[];
    uncertainty: string[];
    revisit: string[];
    evidencePaths: string[];
    completionCriteria: string[];
}
type Guard = {
    path: string;
    expectedRevision: string;
};
export declare function workshopDecisionSeal(frontmatter: ParsedNote['frontmatter'], content: string): {
    version: number;
    fingerprint: string;
};
export declare function workshopDecisionContext(input: WorkshopOutputInput): string;
export declare function workshopTaskDescription(input: WorkshopOutputInput, workshopPath: string): string;
interface Delegation {
    projectId: string;
    accountId: string;
    grantor: string;
    decisionKinds: string[];
    taskKinds: string[];
    scope: string;
    reason: string;
    revoked: boolean;
}
export interface WorkshopOutputAdapter {
    authorizeProject(principal: ScopePrincipal, projectId: string, owner: boolean, delegate?: string, grantor?: string): Promise<Guard>;
    assertAccess(principal: ScopePrincipal, input: WorkshopOutputInput): Promise<void>;
    create(input: WorkshopOutputInput, guards: Guard[], receipt: WorkshopOutputReceipt, principal: ScopePrincipal, projectId: string, assertAccess: () => Promise<void>): Promise<{
        revision: string;
    }>;
    assertReadable?(principal: ScopePrincipal, path: string, container: string): Promise<void>;
    verifyTaskOrigin?(note: ParsedNote, input: WorkshopOutputInput, receipt: WorkshopOutputReceipt): void;
}
/** Reserve the reviewed output on its workshop before normal services create
 * it. A lost response is recovered by stable ID + exact payload and basis,
 * under current authority; the output receipt is never an access grant. */
export declare class WorkshopOutputService {
    private readonly fs;
    private readonly adapter;
    constructor(fs: FileSystemService, adapter: WorkshopOutputAdapter);
    verifyReconciliationReplay(path: string, note: ParsedNote, actor: ScopePrincipal, payload: unknown, revalidate: () => Promise<void>): Promise<void>;
    reconcile(path: string, note: ParsedNote, actor: ScopePrincipal, payload: unknown, revalidate: () => Promise<void>, mutation: {
        requestKey: string;
        payloadHash: string;
    }): Promise<{
        reconciledOutputId: string;
        outcome: "reconciled" | "unresolved";
        success: boolean;
        revision: string;
        authority: string;
    }>;
    private basis;
    cancel(path: string, note: ParsedNote, actor: ScopePrincipal, payload: unknown, revalidate: () => Promise<void>, mutation?: {
        requestKey: string;
        payloadHash: string;
    }): Promise<{
        success: boolean;
        revision: string;
        cancelledOutputId: string;
        authority: string;
    }>;
    private current;
    delegate(path: string, note: ParsedNote, actor: ScopePrincipal, payload: unknown, revalidate: () => Promise<void>, mutation?: {
        requestKey: string;
        payloadHash: string;
    }): Promise<{
        success: boolean;
        revision: string;
        delegation: Delegation;
        authority: string;
    }>;
    execute(path: string, note: ParsedNote, actor: ScopePrincipal, payload: unknown, revalidate: () => Promise<void>, sourceGuards?: Guard[]): Promise<{
        success: boolean;
        path: string;
        revision: string;
        workshopRevision: string;
        replayed: boolean;
        outputId: string;
    }>;
}
export {};
//# sourceMappingURL=workshop-output.d.ts.map