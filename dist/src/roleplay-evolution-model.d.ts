import type { RoleplayCommand, RoleplayState } from './roleplay-model.js';
export type EvolutionKind = 'belief' | 'attitude' | 'event_fact' | 'character_core' | 'world_core' | 'character_lore' | 'world_lore' | 'retract';
export interface EvolutionChange {
    kind: EvolutionKind;
    target: string;
    key: string;
    text?: string;
    lore?: string[];
}
export interface EvolutionSource {
    turnId: string;
    revision: string;
    noteRevision: string;
}
export interface EvolutionProposal {
    id: string;
    author: string;
    characterId: string;
    generation: number;
    roomId: string;
    changes: EvolutionChange[];
    sources: EvolutionSource[];
    reason: string;
    status: 'pending' | 'applied' | 'rejected';
    approvals: string[];
    automatic: boolean;
    basis: string;
    controls: Record<string, {
        controller: string;
        generation: number;
    }>;
    worldApproval: boolean;
    loreGuards: Record<string, string>;
    rejectedBy?: string;
    rejectionReason?: string;
}
export interface RoleplayEvolution {
    mode: 'fixed' | 'evolving';
    worldGmAccounts: string[];
    loreGuards: Record<string, string>;
    proposals: Record<string, EvolutionProposal>;
}
export declare function evolutionGuardMap(value: unknown): Record<string, string>;
export declare function configureEvolution(s: RoleplayState, data: Record<string, any>): void;
export declare const evolutionChangeKey: (c: EvolutionChange) => string;
export declare function evolutionSourceValid(s: RoleplayState, p: EvolutionProposal): boolean;
/** Latest committed value wins. Invalidating it never silently revives an older value. */
export declare function activeEvolution(s: RoleplayState, usable?: (p: EvolutionProposal) => boolean): EvolutionProposal[];
export declare function evolutionPreview(s: RoleplayState, id: string): {
    proposalId: string;
    status: "applied" | "pending" | "rejected";
    revision: string;
    basisValid: boolean;
    requiredControllers: string[];
    requiresWorldGm: boolean;
    designatedWorldGms: string[];
    approvals: string[];
    fingerprint: string;
};
export declare function applyEvolution(s: RoleplayState, command: RoleplayCommand, id: string): {
    characterId: string;
    roomId: string;
    content: string;
};
//# sourceMappingURL=roleplay-evolution-model.d.ts.map