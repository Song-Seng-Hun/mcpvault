import { type CapabilityNode } from './capability-graph.js';
import type { RoleplayCommand, RoleplayPolicy, RoleplayState } from './roleplay-model.js';
interface Formula {
    base: number;
    terms: Record<string, number>;
}
interface Skill extends CapabilityNode {
    kind: 'attack' | 'guard' | 'heal';
    attribute: string;
    power: number;
    focus: number;
}
interface Equipment {
    slot: string;
    defense: number;
}
export interface TrpgRuleset {
    id: string;
    version: string;
    attributes: Record<string, number>;
    derived: Record<string, Formula>;
    resources: Record<string, string>;
    skills: Skill[];
    initialSkills: string[];
    growth: number;
    items: Record<string, Equipment>;
    slots: string[];
    loadoutSize: number;
    actionsPerTurn: number;
    switchCost: number;
    initiative: string;
}
export interface TrpgSheet {
    attributes: Record<string, number>;
    resources: Record<string, number>;
    growth: number;
    learned: string[];
    loadouts: Record<string, {
        skills: string[];
        equipment: string[];
    }>;
    active: string;
    statuses: Record<string, number>;
}
export interface TrpgEncounter {
    order: string[];
    initiative: Record<string, number>;
    round: number;
    turn: number;
    actions: number;
    ended: boolean;
}
export interface RoleplayTrpg {
    ruleset: TrpgRuleset;
    fingerprint: string;
    sheets: Record<string, TrpgSheet>;
    encounters: Record<string, TrpgEncounter>;
}
/** Bounded trusted route provenance, never caller-supplied or a permission grant. */
export declare const ROLEPLAY_REGISTERED_ROUTE: {
    readonly kind: 'registered_action';
    readonly reason: 'Registered declarative mechanics resolved under the canonical writer.';
    readonly skipped: readonly ['gm_dispatch', 'model_dispatch'];
};
export interface TrpgOutcome {
    ruleset: string;
    resources: Array<{
        characterId: string;
        resource: string;
        before: number;
        after: number;
    }>;
    growth: Array<{
        characterId: string;
        before: number;
        after: number;
    }>;
    check?: {
        die: number;
        modifier: number;
        total: number;
        defense: number;
        success: boolean;
    };
    encounter?: {
        round: number;
        current: string;
        actions: number;
        ended: boolean;
    };
}
export declare function trpgOutcome(before: RoleplayState, after: RoleplayState, command: RoleplayCommand, roomId?: string): TrpgOutcome;
export declare const TRPG_FIELDS: Record<string, string[]>;
export declare function defaultTrpgRuleset(): TrpgRuleset;
export declare function validateTrpgRuleset(input: unknown): TrpgRuleset;
export declare function newTrpgSheet(r: TrpgRuleset): TrpgSheet;
export declare function trpgStats(s: RoleplayState, id: string): Record<string, number>;
export declare function trpgCombat(s: RoleplayState, id: string): [string, TrpgEncounter] | undefined;
export declare function trpgRespecPreview(s: RoleplayState, id: string, remove: unknown): {
    characterId: string;
    removed: string[];
    dependencies: {
        skillId: string;
        requires: string;
    }[];
    refund: number;
    unload: {
        name: string;
        skills: string[];
    }[];
    revision: string;
    fingerprint: string;
};
/** Count is only a sizing hint: the reducer validates the complete request before the host draws dice. */
export declare function trpgRollCount(s: RoleplayState, command: RoleplayCommand): number;
export declare function applyTrpg(s: RoleplayState, command: RoleplayCommand, policy: RoleplayPolicy): {
    characterId?: string;
    roomId?: string;
    content: string;
};
/** Prevent legacy mechanics from silently bypassing encounter costs or separating equipped inventory. */
export declare function guardTrpgLegacy(s: RoleplayState, command: RoleplayCommand): void;
export {};
//# sourceMappingURL=roleplay-trpg.d.ts.map