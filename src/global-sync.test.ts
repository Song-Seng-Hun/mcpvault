import { afterEach, beforeEach, expect, test } from 'vitest';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { GlobalSyncClient, GlobalSyncHub, GlobalSyncReplica, startGlobalSyncHub } from './global-sync.js';

let root: string;
let hubRoot: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'mcpvault-global-replica-'));
  hubRoot = await mkdtemp(join(tmpdir(), 'mcpvault-global-hub-'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
  await rm(hubRoot, { recursive: true, force: true });
});

test('Global Hub keeps proposals separate, rejects unsafe paths, and restores tombstoned content', async () => {
  const hub = new GlobalSyncHub(hubRoot, { hubId: 'test-hub' });
  await expect(hub.submitProposal({ documentId: 'Community/private.md', content: 'no', author: 'a', reason: 'bad', origin: 'server-a' })).rejects.toThrow();
  await expect(hub.submitProposal({ documentId: '_scopes/users/alice/private.md', content: 'no', author: 'a', reason: 'bad', origin: 'server-a' })).rejects.toThrow();

  const proposal = await hub.submitProposal({ documentId: 'Knowledge/Answer.md', content: '# First\n', author: 'agent-a', reason: 'Initial grounded note', origin: 'server-a' });
  expect((await hub.getManifest()).entries).toHaveLength(0);
  expect((await hub.approveProposal(proposal.proposalId, 'reviewer-a', 'Evidence checked')).status).toBe('pending');
  const accepted = await hub.approveProposal(proposal.proposalId, 'reviewer-b', 'Evidence checked');
  expect(accepted.status).toBe('approved');
  const first = accepted.revision!;
  expect((await hub.getRevision(first.revisionId)).content).toBe('# First\n');

  const deletion = await hub.submitProposal({ documentId: 'Knowledge/Answer.md', parentRevision: first.revisionId, operation: 'tombstone', author: 'agent-a', reason: 'Superseded', origin: 'server-a' });
  expect((await hub.approveProposal(deletion.proposalId, 'reviewer-a', 'Superseded note retained as tombstone')).status).toBe('pending');
  const deleted = await hub.approveProposal(deletion.proposalId, 'reviewer-b', 'Superseded note retained as tombstone');
  expect(deleted.status).toBe('approved');
  const tombstone = deleted.revision!;
  expect((await hub.getRevision(tombstone.revisionId)).content).toBeUndefined();

  const restored = await hub.restoreDocument('Knowledge/Answer.md', first.revisionId, 'reviewer', 'Restore after mistaken deletion', tombstone.revisionId);
  expect((await hub.getRevision(restored.revisionId)).content).toBe('# First\n');
  expect((await hub.audit()).ok).toBe(true);
});

test('Global replica never overwrites dirty local work and quarantines remote tombstones', async () => {
  const hub = new GlobalSyncHub(hubRoot);
  const client = {
    getManifest: (after?: number, limit?: number) => hub.getManifest(after, limit),
    getRevision: (revisionId: string) => hub.getRevision(revisionId),
    submitProposal: (input: Parameters<typeof hub.submitProposal>[0]) => hub.submitProposal(input),
  };
  const replica = new GlobalSyncReplica({ vaultPath: root, client, trustedPublicKey: hub.getPublicKey() });

  const firstProposal = await hub.submitProposal({ documentId: 'Knowledge/Answer.md', content: 'first\n', author: 'a', reason: 'first', origin: 'server-a' });
  expect((await hub.approveProposal(firstProposal.proposalId, 'reviewer-a', 'accept')).status).toBe('pending');
  const first = (await hub.approveProposal(firstProposal.proposalId, 'reviewer-b', 'accept')).revision!;
  expect((await replica.pull()).applied).toEqual(['Knowledge/Answer.md']);
  expect(await readFile(join(root, 'Knowledge', 'Answer.md'), 'utf8')).toBe('first\n');

  await writeFile(join(root, 'Knowledge', 'Answer.md'), 'local unsubmitted edit\n');
  const secondProposal = await hub.submitProposal({ documentId: 'Knowledge/Answer.md', parentRevision: first.revisionId, content: 'remote second\n', author: 'b', reason: 'second', origin: 'server-b' });
  expect((await hub.approveProposal(secondProposal.proposalId, 'reviewer-a', 'accept')).status).toBe('pending');
  const second = (await hub.approveProposal(secondProposal.proposalId, 'reviewer-b', 'accept')).revision!;
  const conflict = await replica.pull();
  expect(conflict.conflicts[0]?.documentId).toBe('Knowledge/Answer.md');
  expect(await readFile(join(root, 'Knowledge', 'Answer.md'), 'utf8')).toBe('local unsubmitted edit\n');

  await writeFile(join(root, 'Knowledge', 'Answer.md'), 'first\n');
  expect((await replica.pull()).applied).toEqual(['Knowledge/Answer.md']);
  const deletionProposal = await hub.submitProposal({ documentId: 'Knowledge/Answer.md', parentRevision: second.revisionId, operation: 'tombstone', author: 'reviewer', reason: 'Remove obsolete copy', origin: 'server-a' });
  expect((await hub.approveProposal(deletionProposal.proposalId, 'reviewer-a', 'accept')).status).toBe('pending');
  await hub.approveProposal(deletionProposal.proposalId, 'reviewer-b', 'accept');
  const tombstonePull = await replica.pull();
  expect(tombstonePull.applied).toEqual(['Knowledge/Answer.md']);
  await expect(readFile(join(root, 'Knowledge', 'Answer.md'), 'utf8')).rejects.toThrow();
  const quarantine = await readdir(join(root, '.mcpvault', 'global-sync-quarantine'));
  expect(quarantine.length).toBe(1);
  expect(await readFile(join(root, '.mcpvault', 'global-sync-quarantine', quarantine[0]!), 'utf8')).toBe('remote second\n');
});

test('Global Hub HTTP separates proposer and reviewer authority', async () => {
  const handle = await startGlobalSyncHub(hubRoot, { authToken: 'proposer-secret', reviewerToken: 'reviewer-secret', reviewerTokens: { 'reviewer-b': 'reviewer-b-secret' }, proposerOrigin: 'server-a' });
  try {
    const proposer = new GlobalSyncClient({ baseUrl: `http://${handle.host}:${handle.port}`, authToken: 'proposer-secret' });
    const wrongReviewer = new GlobalSyncClient({ baseUrl: `http://${handle.host}:${handle.port}`, authToken: 'proposer-secret', reviewerToken: 'proposer-secret' });
    const reviewer = new GlobalSyncClient({ baseUrl: `http://${handle.host}:${handle.port}`, authToken: 'proposer-secret', reviewerToken: 'reviewer-secret' });
    const secondReviewer = new GlobalSyncClient({ baseUrl: `http://${handle.host}:${handle.port}`, authToken: 'proposer-secret', reviewerToken: 'reviewer-b-secret' });
    const proposal = await proposer.submitProposal({ documentId: 'Knowledge/Http.md', content: 'http\n', author: 'server-a', reason: 'test', origin: 'server-a' });
    await expect(wrongReviewer.approveProposal(proposal.proposalId, 'not-authorized', 'no')).rejects.toThrow('Unauthorized');
    expect((await reviewer.approveProposal(proposal.proposalId, 'forged', 'checked')).status).toBe('pending');
    const accepted = await secondReviewer.approveProposal(proposal.proposalId, 'also-forged', 'checked');
    expect(accepted.status).toBe('approved');
    expect(accepted.revision?.origin).toBe('server-a');
  } finally {
    await handle.close();
  }
});

test('Global Hub persists its signing key and binds reviewer identity to the token', async () => {
  const firstHandle = await startGlobalSyncHub(hubRoot, {
    authToken: 'proposer-secret',
    reviewerToken: 'reviewer-a-secret',
    reviewerTokens: { 'reviewer-b': 'reviewer-b-secret' },
  });
  const publicKey = firstHandle.hub.getPublicKey();
  await firstHandle.close();

  const secondHandle = await startGlobalSyncHub(hubRoot, {
    authToken: 'proposer-secret',
    reviewerToken: 'reviewer-a-secret',
    reviewerTokens: { 'reviewer-b': 'reviewer-b-secret' },
  });
  expect(secondHandle.hub.getPublicKey()).toBe(publicKey);
  try {
    const baseUrl = `http://${secondHandle.host}:${secondHandle.port}`;
    const proposer = new GlobalSyncClient({ baseUrl, authToken: 'proposer-secret' });
    const reviewerA = new GlobalSyncClient({ baseUrl, authToken: 'proposer-secret', reviewerToken: 'reviewer-a-secret' });
    const reviewerB = new GlobalSyncClient({ baseUrl, authToken: 'proposer-secret', reviewerToken: 'reviewer-b-secret' });
    const proposal = await proposer.submitProposal({ documentId: 'Knowledge/Quorum.md', content: 'quorum\n', author: 'server-a', reason: 'test', origin: 'server-a' });
    const pending = await reviewerA.approveProposal(proposal.proposalId, 'forged-reviewer', 'checked');
    expect(pending.proposal.approvals).toEqual(['reviewer']);
    const accepted = await reviewerB.approveProposal(proposal.proposalId, 'also-forged', 'checked');
    const deletion = await proposer.submitProposal({ documentId: 'Knowledge/Quorum.md', parentRevision: accepted.revision!.revisionId, operation: 'tombstone', author: 'server-a', reason: 'remove', origin: 'server-a' });
    expect((await reviewerA.approveProposal(deletion.proposalId, 'someone-else', 'checked')).status).toBe('pending');
    expect((await reviewerB.approveProposal(deletion.proposalId, 'still-forged', 'checked')).status).toBe('approved');
  } finally {
    await secondHandle.close();
  }
});

test('Global Hub rebuilds from its signed event chain and fails closed on event tampering', async () => {
  const hub = new GlobalSyncHub(hubRoot);
  const proposal = await hub.submitProposal({ documentId: 'Knowledge/Integrity.md', content: 'integrity\n', author: 'server-a', reason: 'test', origin: 'server-a' });
  expect((await hub.approveProposal(proposal.proposalId, 'reviewer-a', 'checked')).status).toBe('pending');
  expect((await hub.approveProposal(proposal.proposalId, 'reviewer-b', 'checked')).status).toBe('approved');

  const statePath = join(hubRoot, 'state.json');
  const state = JSON.parse(await readFile(statePath, 'utf8')) as Record<string, unknown>;
  state.nextSequence = 999_999;
  state.heads = {};
  await writeFile(statePath, JSON.stringify(state));
  const signingPrivateKey = hub.exportSigningPrivateKey();
  const recovered = new GlobalSyncHub(hubRoot, { signingPrivateKey });
  expect((await recovered.getManifest()).entries).toHaveLength(1);

  const eventPath = join(hubRoot, 'events.ndjson');
  const firstEvent = JSON.parse((await readFile(eventPath, 'utf8')).split(/\r?\n/)[0]!) as Record<string, unknown>;
  firstEvent.payload = { tampered: true };
  await writeFile(eventPath, `${JSON.stringify(firstEvent)}\n`);
  const broken = new GlobalSyncHub(hubRoot, { signingPrivateKey });
  await expect(broken.getManifest()).rejects.toThrow('invalid event chain');
});

test('Global Hub makes proposal retries idempotent and rejects key reuse with different content', async () => {
  const hub = new GlobalSyncHub(hubRoot);
  const input = { documentId: 'Knowledge/Retry.md', content: 'retry\n', author: 'server-a', reason: 'test', origin: 'server-a', idempotencyKey: 'request-001' };
  const first = await hub.submitProposal(input);
  expect(await hub.submitProposal(input)).toEqual(first);
  await expect(hub.submitProposal({ ...input, content: 'different\n' })).rejects.toThrow('idempotencyKey was already used');
  expect((await hub.approveProposal(first.proposalId, 'reviewer-a', 'checked')).status).toBe('pending');
  expect((await hub.approveProposal(first.proposalId, 'reviewer-b', 'checked')).status).toBe('approved');
  expect(await hub.submitProposal(input)).toEqual(expect.objectContaining({ proposalId: first.proposalId, status: 'approved' }));
});
