import type { Character, RoleplayState } from './roleplay-model.js';
export declare function textRows(kind: string, text: string): Array<Record<string, any>>;
/** Read projections only: never split a submitted message into multiple posts. */
export declare function characterItems(c: Character, state: RoleplayState, availableTurns: ReadonlySet<string>): Array<Record<string, any>>;
export declare function worldItems(state: RoleplayState): Array<Record<string, any>>;
//# sourceMappingURL=roleplay-projections.d.ts.map