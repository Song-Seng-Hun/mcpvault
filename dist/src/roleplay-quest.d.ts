import type { RoleplayStore } from './roleplay-store.js';
import type { EconomyPolicy, QuestArtifact, QuestContract } from './economy-model.js';
/** Called inside the existing quest review/settlement coordinator. Never pays or mints. */
export declare function validateRoleplayQuestArtifact(store: RoleplayStore | undefined, artifact: QuestArtifact, contract: QuestContract, policy: EconomyPolicy): Promise<void>;
//# sourceMappingURL=roleplay-quest.d.ts.map