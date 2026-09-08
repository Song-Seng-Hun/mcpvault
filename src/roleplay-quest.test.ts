import { afterEach, expect, test } from 'vitest';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { validateRoleplayQuestArtifact } from './roleplay-quest.js';
import { roleplayHash, roleplayRevision, type RoleplayCommand } from './roleplay-model.js';
import { RoleplayStore } from './roleplay-store.js';
import type { EconomyPolicy, QuestArtifact, QuestContract } from './economy-model.js';

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });

const economy: EconomyPolicy = {
  version: 1, revision: 'roleplay-quest-pilot', enabled: true, treasury: 'treasury', operators: ['operator'],
  owners: { treasury: 'owner-treasury', issuer: 'owner-issuer', worker: 'owner-worker', reviewer: 'owner-reviewer', imposter: 'owner-imposter' },
  reviewers: ['reviewer'], subjectiveReview: true, maxSupply: 1000, minReward: 10, maxReward: 100,
  postingFee: 1, reviewFee: 1, dailySpend: 100, dailyPosts: 1, openContracts: 1,
};

function contract(overrides: Partial<QuestContract> = {}): QuestContract {
  return {
    id: 'quest', requester: 'issuer', requesterOwner: 'owner-issuer',
    terms: { taskId: 'task', taskRevision: 'a'.repeat(64), title: 'Quest', criteria: ['Set the quest flag'], exclusions: [], reward: 10, kind: 'creative', deadline: '2099-01-01T00:00:00.000Z', verifier: 'independent-review-v1' },
    policyRevision: economy.revision, reviewFee: 1, postingFee: 1, escrow: 11, status: 'claimed', generation: 1,
    createdAt: '2020-01-01T00:00:00.000Z', updatedAt: '2020-01-01T00:00:00.000Z', fundedAt: '2020-01-02T00:00:00.000Z',
    worker: 'worker', workerOwner: 'owner-worker', reviewer: 'reviewer', reviewerOwner: 'owner-reviewer', revisionRequests: 0,
    ...overrides,
  };
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'roleplay-quest-')); roots.push(root);
  const vaultPath = join(root, 'vault'), hostPath = join(root, 'host'); await mkdir(vaultPath); await mkdir(hostPath);
  const store = await RoleplayStore.open({ vaultPath, hostPath, policy: { administrators: ['host'] } });
  const commit = async (op: string, actor: string, data: Record<string, unknown>) => {
    const state = await store.snapshot();
    return store.transact({ op, actor, data, requestId: `request-${state.sequence}`, expectedRevision: roleplayRevision(state) } as RoleplayCommand);
  };
  await commit('initialize', 'host', { title: 'Quest world', places: { hall: [] } });
  await commit('character', 'host', { id: 'hero', name: 'Hero', controller: 'worker', location: 'hall' });
  await commit('scene', 'host', { roomId: 'hall', location: 'hall', title: 'Quest hall', gm: 'host' });
  await commit('rule', 'host', { id: 'complete-quest', questId: 'quest', conditions: [], effects: [{ op: 'flag', characterId: '$actor', key: 'quest-complete', value: true }] });
  const turn = await commit('use', 'worker', { characterId: 'hero', generation: 1, roomId: 'hall', ruleId: 'complete-quest', content: 'I complete the agreed fictional objective.' });
  return { store, turn, artifact: { path: turn.path, revision: turn.noteRevision } satisfies QuestArtifact, commit };
}

test('requires an enabled economy before reading roleplay reward evidence', async () => {
  const f = await fixture();
  try {
    await expect(validateRoleplayQuestArtifact(f.store, f.artifact, contract(), { ...economy, enabled: false })).rejects.toThrow(/configured world and approved economy/i);
  } finally { await f.store.close(); }
});

test('accepts only the exact committed quest turn path, revision, and quest binding', async () => {
  const f = await fixture();
  try {
    await expect(validateRoleplayQuestArtifact(f.store, f.artifact, contract(), economy)).resolves.toBeUndefined();
    await expect(validateRoleplayQuestArtifact(f.store, { ...f.artifact, revision: 'b'.repeat(64) }, contract(), economy)).rejects.toThrow(/not bound/i);
    await expect(validateRoleplayQuestArtifact(f.store, f.artifact, contract({ id: 'other-quest' }), economy)).rejects.toThrow(/not bound/i);
  } finally { await f.store.close(); }
});

test('requires the committed actor to remain the contract worker under the exact approved owner', async () => {
  const f = await fixture();
  try {
    await expect(validateRoleplayQuestArtifact(f.store, f.artifact, contract({ worker: 'imposter', workerOwner: 'owner-imposter' }), economy)).rejects.toThrow(/owner|funded-event basis/i);
    await expect(validateRoleplayQuestArtifact(f.store, f.artifact, contract(), { ...economy, owners: { ...economy.owners, worker: 'owner-imposter' } })).rejects.toThrow(/owner|funded-event basis/i);
  } finally { await f.store.close(); }
});

test('rejects a turn that predates the funded contract timestamp', async () => {
  const f = await fixture();
  try {
    await expect(validateRoleplayQuestArtifact(f.store, f.artifact, contract({ fundedAt: '2999-01-01T00:00:00.000Z' }), economy)).rejects.toThrow(/funded-event basis/i);
  } finally { await f.store.close(); }
});

test('requires an existing approved reviewer with an owner independent from requester and worker', async () => {
  const f = await fixture();
  try {
    await expect(validateRoleplayQuestArtifact(f.store, f.artifact, contract({ reviewer: 'imposter', reviewerOwner: 'owner-imposter' }), economy)).rejects.toThrow(/independent subjective quest review/i);
    await expect(validateRoleplayQuestArtifact(f.store, f.artifact, contract({ reviewerOwner: 'owner-worker' }), economy)).rejects.toThrow(/independent subjective quest review/i);
    await expect(validateRoleplayQuestArtifact(f.store, f.artifact, contract({ reviewerOwner: 'owner-issuer' }), economy)).rejects.toThrow(/independent subjective quest review/i);
  } finally { await f.store.close(); }
});

test('invalidates a previously committed game turn once a correction records it as corrected evidence', async () => {
  const f = await fixture();
  try {
    const before = await f.store.snapshot();
    const correction = {
      targetTurn: f.turn.id, content: 'The fictional completion was corrected.', reason: 'The flag was recorded in error.',
      effects: [{ op: 'flag', characterId: 'hero', key: 'quest-complete', value: false }],
    };
    await f.commit('correct', 'host', { ...correction, previewFingerprint: roleplayHash({ revision: roleplayRevision(before), ...correction }) });
    await expect(validateRoleplayQuestArtifact(f.store, f.artifact, contract(), economy)).rejects.toThrow(/corrected/i);
  } finally { await f.store.close(); }
});
