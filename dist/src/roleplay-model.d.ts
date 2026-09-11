export { roleplayHash, roleplayRevision, roleplayId, roleplayAccount, roleplayText } from './roleplay-kernel.js';
import { type RoleplayEvolution } from './roleplay-evolution-model.js';
import { ROLEPLAY_REGISTERED_ROUTE, type RoleplayTrpg, type TrpgOutcome } from './roleplay-trpg.js';
export interface RoleplayPolicy {
    administrators: string[];
    maxCharacters?: number;
}
export interface Character {
    id: string;
    name: string;
    controller: string;
    generation: number;
    location: string;
    definition: string;
    lore: string[];
    coreMemory: string;
    stats: Record<string, number>;
    flags: Record<string, string | boolean>;
    relations: Record<string, number>;
    cognition: Array<{
        turn: string;
        kind: 'known' | 'witnessed' | 'heard' | 'inferred';
        note: string;
    }>;
}
export interface Scene {
    roomId: string;
    location: string;
    title: string;
    gm?: string;
}
export type Effect = {
    op: 'flag';
    characterId: string;
    key: string;
    value: string | boolean;
} | {
    op: 'stat' | 'relation';
    characterId: string;
    key: string;
    value: number;
    mode?: 'set' | 'increment';
} | {
    op: 'move';
    characterId: string;
    to: string;
} | {
    op: 'transfer';
    itemId: string;
    from: string;
    to: string;
    amount: number;
};
export interface Condition {
    op: 'exists' | 'equals' | 'range' | 'location' | 'quantity';
    characterId?: string;
    key?: string;
    value?: string | boolean | number;
    min?: number;
    max?: number;
    itemId?: string;
    owner?: string;
}
export interface Rule {
    id: string;
    conditions: Condition[];
    effects: Effect[];
    questId?: string;
}
export interface RoleplayCommand {
    op: string;
    actor: string;
    requestId: string;
    expectedRevision: string;
    data: Record<string, any>;
    rolls?: number[];
}
export interface RoleplayReceipt {
    id: string;
    sequence: number;
    actor: string;
    characterId?: string;
    roomId?: string;
    kind: string;
    content: string;
    effects: Effect[];
    revision: string;
    correctedTurn?: string;
    witnesses: string[];
    questId?: string;
    dependencies?: string[];
    mechanics?: TrpgOutcome;
    route?: typeof ROLEPLAY_REGISTERED_ROUTE;
}
export interface Pending {
    id: string;
    characterId: string;
    generation: number;
    location: string;
    roomId: string;
    characterFingerprint: string;
    content: string;
    trpgBasis?: string;
}
export interface RoleplayState {
    trpg?: RoleplayTrpg;
    evolution?: RoleplayEvolution;
    sequence: number;
    title?: string;
    definition?: string;
    lore?: string[];
    places: Record<string, string[]>;
    delegates: string[];
    characters: Record<string, Character>;
    scenes: Record<string, Scene>;
    rules: Record<string, Rule>;
    items: Record<string, Record<string, number>>;
    pending: Record<string, Pending>;
    requests: Record<string, {
        fingerprint: string;
        receipt: RoleplayReceipt;
    }>;
}
export declare const initialRoleplay: () => RoleplayState;
export declare function validateEffects(input: unknown): Effect[];
/** Advisory only: execution rechecks conditions, effects, control and revisions. */
export declare function roleplayRuleConditionsMatch(s: RoleplayState, rule: Rule, id: string): boolean;
/** Pure transition: no wall clock, generated prose, script evaluator or actual economy. */
export declare function applyRoleplayCommand(before: RoleplayState, command: RoleplayCommand, policy: RoleplayPolicy): {
    state: RoleplayState;
    receipt: RoleplayReceipt;
};
//# sourceMappingURL=roleplay-model.d.ts.map