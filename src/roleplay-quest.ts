import type { RoleplayStore } from './roleplay-store.js';
import type { EconomyPolicy, QuestArtifact, QuestContract } from './economy-model.js';

/** Called inside the existing quest review/settlement coordinator. Never pays or mints. */
export async function validateRoleplayQuestArtifact(store: RoleplayStore | undefined, artifact: QuestArtifact, contract: QuestContract, policy: EconomyPolicy): Promise<void> {
  if (!store || !policy.enabled) throw new Error('Roleplay reward evidence requires a configured world and approved economy');
  if (contract.terms.kind === 'mechanical' || !contract.worker || !contract.workerOwner || !contract.reviewer || !contract.reviewerOwner || !contract.fundedAt
    || !policy.subjectiveReview || !policy.reviewers.includes(contract.reviewer)
    || policy.owners[contract.reviewer] !== contract.reviewerOwner
    || contract.reviewerOwner === contract.requesterOwner || contract.reviewerOwner === contract.workerOwner) throw new Error('Game outcomes need funded independent subjective quest review');
  const { records } = await store.read();
  const record = records.find(r => r.path === artifact.path && r.revision === artifact.revision);
  if (!record || record.event.receipt.questId !== contract.id || !record.event.receipt.effects.length) throw new Error('Turn is not bound to this approved quest');
  if (record.event.receipt.actor !== contract.worker || policy.owners[record.event.receipt.actor] !== contract.workerOwner || record.event.at < contract.fundedAt) throw new Error('Game reward owner or funded-event basis mismatch');
  if (records.some(r => r.event.receipt.correctedTurn === record.event.receipt.id)) throw new Error('Game evidence corrected; fresh review or existing dispute process required');
}
