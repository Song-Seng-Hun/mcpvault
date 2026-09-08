import { guidanceError } from './guidance-runtime.js';
/** Called inside the existing quest review/settlement coordinator. Never pays or mints. */
export async function validateRoleplayQuestArtifact(store, artifact, contract, policy) {
    if (!store || !policy.enabled)
        throw guidanceError(new Error('Roleplay reward evidence requires a configured world and approved economy'), 'guid-5c3638983ac643ed');
    if (contract.terms.kind === 'mechanical' || !contract.worker || !contract.workerOwner || !contract.reviewer || !contract.reviewerOwner || !contract.fundedAt
        || !policy.subjectiveReview || !policy.reviewers.includes(contract.reviewer)
        || policy.owners[contract.reviewer] !== contract.reviewerOwner
        || contract.reviewerOwner === contract.requesterOwner || contract.reviewerOwner === contract.workerOwner)
        throw guidanceError(new Error('Game outcomes need funded independent subjective quest review'), 'guid-2b74c4c5d4e49020');
    const { records } = await store.read();
    const record = records.find(r => r.path === artifact.path && r.revision === artifact.revision);
    if (!record || record.event.receipt.questId !== contract.id || !record.event.receipt.effects.length)
        throw guidanceError(new Error('Turn is not bound to this approved quest'), 'guid-5d256bca0104cb60');
    if (record.event.receipt.actor !== contract.worker || policy.owners[record.event.receipt.actor] !== contract.workerOwner || record.event.at < contract.fundedAt)
        throw guidanceError(new Error('Game reward owner or funded-event basis mismatch'), 'guid-e0ac5891388c8863');
    if (records.some(r => r.event.receipt.correctedTurn === record.event.receipt.id))
        throw guidanceError(new Error('Game evidence corrected; fresh review or existing dispute process required'), 'guid-931c555c4dec8454');
}
