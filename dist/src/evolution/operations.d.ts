import type { HostWorkStorage } from '../host-work-storage.js';
import type { EvolutionConfig } from './model.js';
import type { EvolutionRuntimeHost } from './runtime-connection.js';
import { type MemoryDeliveryEvidence } from './memory-observation.js';
export declare const OBSERVED_ENDPOINTS: Set<string>;
export interface OperationActor {
    accountId: string;
    modelId: string;
    authority: string;
    assert(): Promise<void>;
}
interface Observation {
    version: 1;
    taskId: string;
    requestId: string;
    fingerprint: string;
    endpointId: string;
    state: 'started' | 'completed' | 'failed';
    returnedChars?: number;
    returnedBytes?: number;
    elapsedMs?: number;
    resultHash?: string;
    measurementScope: 'search_server' | 'memory_server' | 'continuity_server';
    effectVerified: false;
    evidence?: MemoryDeliveryEvidence;
    selectedHarness?: {
        cycleId: string;
        revision: string;
    };
    resourceRevisions?: string[];
}
/** Server observations, never client-authored success logs. Bodies and credentials are not persisted. */
export declare class EvolutionOperations {
    private readonly storage;
    private readonly host;
    private readonly actor;
    private tail;
    private closed;
    constructor(storage: HostWorkStorage<EvolutionConfig>, host: EvolutionRuntimeHost, actor: (token: string, write: boolean) => Promise<OperationActor>);
    private key;
    private serial;
    private task;
    begin(token: string, args: Record<string, any>): Promise<{
        packet: any;
        receipts: {
            cycleId: string;
            token: string;
        }[];
        retention: 'unknown';
        task: {
            id: string;
            sessionProvenance: string;
            effectVerified: boolean;
        };
        nextAction: {
            endpointId: string;
            arguments: {
                evolutionTask: string;
                evolutionRequestId: string;
            };
        };
    }>;
    observations(token: string, args: Record<string, any>): Promise<{
        taskId: string;
        revision: string;
        items: Observation[];
        modelTokens: null;
        effectVerified: boolean;
        partial: boolean;
        nextAction: {
            endpointId: string;
            arguments: {
                op: string;
                taskId: string;
                offset: number;
                expectedRevision: string;
                maxChars?: number;
            };
        } | null;
    }>;
    run<T>(token: string, endpointId: string, args: Record<string, any>, operation: () => Promise<T>): Promise<T>;
    private finish;
    close(): Promise<void>;
}
export {};
//# sourceMappingURL=operations.d.ts.map