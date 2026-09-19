import type { IncomingMessage, ServerResponse } from 'node:http';
import type { HostWorkStorage } from '../host-work-storage.js';
import type { EvolutionConfig } from './model.js';
import type { OperationActor } from './operations.js';
interface Review {
    version: 1;
    accountId: string;
    authority: string;
    id: string;
    fingerprint: string;
    expires: number;
    state: 'pending' | 'consuming' | 'recorded';
    feedback: Record<string, unknown>;
    effect?: {
        cycleId: string;
        expectedRevision: string;
        deliveryToken: string;
        responseHash: string;
    };
}
interface Dependencies {
    actor(token: string, write: boolean): Promise<OperationActor>;
    login(accountId: string, password: string): Promise<string>;
    logout(token: string): Promise<unknown>;
    record(token: string, review: Review): Promise<unknown>;
    inspectEffect(token: string, args: Record<string, any>): Promise<Record<string, unknown>>;
    recordEffect(token: string, review: Review): Promise<unknown>;
}
/** A bounded direct-review surface, not an operator grant, model tool or OS isolation boundary. */
export declare class EvolutionDirectReview {
    private readonly storage;
    private readonly deps;
    private readonly now;
    private tail;
    private sessions;
    private closed;
    private excerpts;
    constructor(storage: HostWorkStorage<EvolutionConfig>, deps: Dependencies, now?: () => number);
    private key;
    private serial;
    prepareEffect(token: string, args: Record<string, any>): Promise<{
        status: string;
        reviewId: string;
        expiresInSeconds: number;
        reviewPath: string;
        notice: string;
    }>;
    prepare(token: string, args: Record<string, any>): Promise<{
        status: string;
        reviewId: string;
        expiresInSeconds: number;
        reviewPath: string;
        notice: string;
    }>;
    private prepareRecord;
    private pending;
    confirm(token: string, reviewId: string): Promise<unknown>;
    handle(req: IncomingMessage, res: ServerResponse): Promise<void>;
    close(): Promise<void>;
}
export {};
//# sourceMappingURL=direct-review.d.ts.map