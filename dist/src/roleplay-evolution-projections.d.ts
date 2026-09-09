import { type EvolutionProposal } from './roleplay-evolution-model.js';
import type { RoleplayState } from './roleplay-model.js';
export declare function evolutionRows(s: RoleplayState, usable: (p: EvolutionProposal) => boolean, target?: string): Array<Record<string, any>>;
export declare function evolutionProposalRows(s: RoleplayState, p: EvolutionProposal, loreValid: boolean): Array<Record<string, any>>;
export declare function currentLore(s: RoleplayState, usable: (p: EvolutionProposal) => boolean, characterId?: string): string[];
//# sourceMappingURL=roleplay-evolution-projections.d.ts.map