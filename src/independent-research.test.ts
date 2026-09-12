import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, isAbsolute, join, relative } from 'node:path';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { createServer } from '../tests/server-fixture.js';
import { FileSystemService } from './filesystem.js';

let vault: string, base: string, client: Client, server: ReturnType<typeof createServer>;
const tokens: Record<string, string> = {};
async function call(endpointId: string, args: Record<string, unknown> = {}, who = 'owner') {
  const result = await client.callTool({ name: 'call_endpoint', arguments: { endpointId, arguments: { ...args, ...(tokens[who] && { accessToken: tokens[who] }) } } });
  if (result.isError) throw new Error(JSON.stringify(result.content));
  return JSON.parse((result.content[0] as { text: string }).text);
}
beforeEach(async () => {
  base = await realpath(tmpdir()); vault = await mkdtemp(join(base, 'mcpvault-independent-'));
  server = createServer(vault, { version: '1.0.0' });
  const [left, right] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: 'independent-research-test', version: '1.0.0' });
  await Promise.all([client.connect(left), server.connect(right)]);
  for (const who of ['owner', 'peer', 'outside']) {
    delete tokens[who];
    tokens[who] = (await call('auth.register', { accountId: who, agentId: who, modelId: 'codex', userId: `family-${who}`, password: `disposable-research-${who}-password` }, who)).accessToken;
  }
  await call('workshop.create', { workshopId: 'research', title: 'Neutral question', prompt: 'Which constraints change the answer?' });
});
afterEach(async () => {
  vi.restoreAllMocks();
  await client?.close(); await server?.close();
  const actual = await realpath(vault), rel = relative(base, actual);
  if (!rel || rel.startsWith('..') || isAbsolute(rel) || !basename(actual).startsWith('mcpvault-independent-')) throw new Error('Unsafe test cleanup');
  await rm(actual, { recursive: true, force: true });
});

test('hidden references are not echoed through the neutral config or saved closure', async () => {
  await call('notes.write', { path: 'Evidence.md', content: 'Source', expectedRevision: 'missing' });
  const workshop = await call('workshop.read', { workshopId: 'research' });
  const created = await call('workshop.research_update', { workshopId: 'research', roundId: 'first', operation: 'create', config: { ...config, question: 'Check [[Evidence|SENSITIVE-SOURCE-TITLE]]' }, expectedRevision: 'missing', expectedWorkshopRevision: workshop.workshop.revision, requestId: 'create' });
  const fs = new FileSystemService(vault), evidence = await fs.readNote('Evidence.md');
  await fs.writeNote({ path: 'Evidence.md', content: evidence.content, frontmatter: { moderation_status: 'hidden' }, expectedRevision: evidence.revision });
  await expect(read('peer')).rejects.toThrow(/reference|unavailable/i);
  expect(created.phase).toBe('collecting');
});

test('account revocation at the guarded write boundary prevents durable submission', async () => {
  const created = await createRound();
  const original = FileSystemService.prototype.writeNoteWithRevisionGuardsAndReceipt;
  let intercepted = false;
  vi.spyOn(FileSystemService.prototype, 'writeNoteWithRevisionGuardsAndReceipt').mockImplementation(async function (params, guards, policy) {
    if (params.path.startsWith('_whispers/research/') && !intercepted) { intercepted = true; await call('auth.logout'); }
    return original.call(this, params, guards, policy);
  });
  await expect(update('submit', created.revision, 'owner', { submission: submission('REVOKED-WRITE') })).rejects.toThrow(/actor|token|login|authenticated/i);
  expect(intercepted).toBe(true);
  const stored = await new FileSystemService(vault).readNote('_whispers/research/research/first.md');
  expect(stored.revision).toBe(created.revision);
});

test('different evidence sources across participants fit the aggregate guarded disclosure budget', async () => {
  let current = await createRound();
  const sources: Array<{ path: string; revision: string }> = [];
  for (let n = 0; n < 10; n++) {
    const path = `Evidence-${n}.md`;
    await call('notes.write', { path, content: `Observation ${n}`, expectedRevision: 'missing' });
    sources.push({ path, revision: (await call('notes.read', { path, maxChars: 1000 })).revision });
  }
  current = await update('submit', current.revision, 'owner', { submission: { ...submission('One'), evidence: sources.slice(0, 5) } });
  current = await update('submit', current.revision, 'peer', { submission: { ...submission('Two'), evidence: sources.slice(5) } });
  expect((await update('disclose', current.revision)).phase).toBe('review');
});

test('oversized accepted Unicode submissions can be retrieved by progressive detail rows', async () => {
  const workshop = await call('workshop.read', { workshopId: 'research' });
  const created = await call('workshop.research_update', { workshopId: 'research', roundId: 'first', operation: 'create', config: { ...config, question: '😀'.repeat(1000), constraints: Array.from({ length: 8 }, () => '😀'.repeat(280)) }, expectedRevision: 'missing', expectedWorkshopRevision: workshop.workshop.revision, requestId: 'create' });
  await update('submit', created.revision, 'owner', { submission: { candidate: '😀'.repeat(1200), conditions: '😀'.repeat(700), failedSearches: '😀'.repeat(700), uncertainties: '😀'.repeat(700), evidence: [] } });
  const packet = await read('owner', { maxChars: 12000, limit: 1 });
  expect(JSON.stringify(packet).length).toBeLessThanOrEqual(12000);
  expect(packet.items[0].nextAction).toBeTruthy();
  const action = packet.items[0].nextAction;
  const detail = await call(action.endpointId, action.arguments);
  expect(detail.items.some((item: any) => item.field === 'candidate' && item.value === '😀'.repeat(1200))).toBe(true);
  expect(JSON.stringify(detail).length).toBeLessThanOrEqual(12000);
});

test('corrupt stored synthesis without disclosure or independent reviews fails closed', async () => {
  await createRound();
  const fs = new FileSystemService(vault), path = '_whispers/research/research/first.md', note = await fs.readNote(path);
  note.frontmatter.research.phase = 'closed';
  note.frontmatter.research.closure = { outcome: 'synthesis', explanation: 'FORGED-SYNTHESIS', accountId: 'owner' };
  await fs.writeNote({ path, content: note.content, frontmatter: note.frontmatter, expectedRevision: note.revision });
  await expect(read('peer')).rejects.toThrow(/malformed|synthesis|review|disclosure/i);
});

test('references to the parent Workshop retain their authored snapshot', async () => {
  const workshop = await call('workshop.read', { workshopId: 'research' });
  await call('workshop.research_update', { workshopId: 'research', roundId: 'first', operation: 'create', config: { ...config, question: 'Investigate [[Community/Workshops/research]]' }, expectedRevision: 'missing', expectedWorkshopRevision: workshop.workshop.revision, requestId: 'create' });
  expect((await read('peer')).config.question).toContain('[[Community/Workshops/research]]');
});

test('late hidden source guard failures do not expose its path or hashes', async () => {
  const created = await createRound();
  await call('notes.write', { path: 'SENSITIVE-PATH.md', content: 'Source', expectedRevision: 'missing' });
  const fs = new FileSystemService(vault), source = await fs.readNote('SENSITIVE-PATH.md');
  const original = FileSystemService.prototype.writeNoteWithRevisionGuardsAndReceipt;
  let intercepted = false;
  vi.spyOn(FileSystemService.prototype, 'writeNoteWithRevisionGuardsAndReceipt').mockImplementation(async function (params, guards, policy) {
    if (params.path.startsWith('_whispers/research/') && !intercepted) {
      intercepted = true;
      await fs.writeNote({ path: 'SENSITIVE-PATH.md', content: source.content, frontmatter: { moderation_status: 'hidden' }, expectedRevision: source.revision });
    }
    return original.call(this, params, guards, policy);
  });
  let failure = '';
  try { await update('submit', created.revision, 'owner', { submission: { ...submission('hypothesis'), evidence: [{ path: 'SENSITIVE-PATH.md', revision: source.revision }] } }); }
  catch (error) { failure = String(error); }
  expect(intercepted).toBe(true);
  expect(failure).toBeTruthy();
  expect(failure).not.toContain('SENSITIVE-PATH');
  expect(failure).not.toContain(source.revision);
});

test('nonterminal storage admission reserves capacity for unresolved closure', async () => {
  await createRound();
  const fs = new FileSystemService(vault), path = '_whispers/research/research/first.md', note = await fs.readNote(path);
  // Simulate a near-full persisted record; no operational NAS data is touched.
  note.frontmatter.research.retainedMetadata = 'x'.repeat(120000 - JSON.stringify(note.frontmatter.research).length);
  await fs.writeNote({ path, content: note.content, frontmatter: note.frontmatter, expectedRevision: note.revision });
  const current = await read();
  await expect(update('submit', current.revision, 'owner', { submission: submission('more data') })).rejects.toThrow(/storage|capacity|budget/i);
  expect((await update('close', current.revision, 'owner', { closure: { outcome: 'unresolved', explanation: 'Capacity reached; continue in a new round.' } })).phase).toBe('closed');
});
const config = { question: 'Which explanation fits?', constraints: ['Find counterexamples'], participants: ['owner', 'peer'], budgetMinutes: 30 };
const submission = (candidate: string) => ({ candidate, conditions: 'Only the tested environment', failedSearches: 'No independent source yet', uncertainties: 'Unverified hypothesis', evidence: [] });
async function createRound(roundId = 'first') {
  const workshop = await call('workshop.read', { workshopId: 'research', maxChars: 2000 });
  return call('workshop.research_update', { workshopId: 'research', roundId, operation: 'create', config, expectedRevision: 'missing', expectedWorkshopRevision: workshop.workshop.revision, requestId: `create-${roundId}` });
}
const read = (who = 'owner', more: Record<string, unknown> = {}) => call('workshop.research', { workshopId: 'research', roundId: 'first', ...more }, who);
const update = (operation: string, revision: string, who = 'owner', more: Record<string, unknown> = {}) => call('workshop.research_update', { workshopId: 'research', roundId: 'first', operation, expectedRevision: revision, requestId: `${operation}-${who}`, ...more }, who);

test('a closed Workshop permits only its facilitator to close existing research unresolved without disclosure', async () => {
  let current = await createRound();
  current = await update('submit', current.revision, 'owner', { submission: submission('CLOSED-PARENT-PRIVATE') });
  const workshop = await call('workshop.read', { workshopId: 'research' });
  const parent = await call('workshop.phase', { workshopId: 'research', phase: 'closed', reason: 'No further workshop work', expectedRevision: workshop.workshop.revision });
  const closure = { outcome: 'unresolved', explanation: 'Parent closed; preserve private independent work.' };
  await expect(update('submit', current.revision, 'peer', { submission: submission('NEW') })).rejects.toThrow(/closed/i);
  await expect(update('disclose', current.revision)).rejects.toThrow(/closed/i);
  await expect(update('close', current.revision, 'owner', { closure: { ...closure, outcome: 'synthesis' } })).rejects.toThrow(/closed/i);
  await expect(createRound('later')).rejects.toThrow(/closed/i);
  await expect(update('close', current.revision, 'peer', { closure })).rejects.toThrow(/facilitator/i);
  const attempts = await Promise.allSettled(['first-close', 'second-close'].map(requestId =>
    update('close', current.revision, 'owner', { closure, requestId })));
  expect(attempts.filter(a => a.status === 'fulfilled')).toHaveLength(1);
  const winner = attempts[0]!.status === 'fulfilled' ? 'first-close' : 'second-close';
  const retry = await update('close', current.revision, 'owner', { closure, requestId: winner });
  expect(retry.replay).toBe(true); expect(retry.phase).toBe('closed');
  const peer = await read('peer');
  expect(peer.phase).toBe('closed'); expect(JSON.stringify(peer)).not.toContain('CLOSED-PARENT-PRIVATE');
  expect((await call('workshop.read', { workshopId: 'research' })).workshop.revision).toBe(parent.revision);
});

test('late parent drift rejects unresolved cleanup without changing the research record', async () => {
  const current = await createRound();
  const workshop = await call('workshop.read', { workshopId: 'research' });
  await call('workshop.phase', { workshopId: 'research', phase: 'closed', reason: 'Closed', expectedRevision: workshop.workshop.revision });
  const fs = new FileSystemService(vault), original = FileSystemService.prototype.writeNoteWithRevisionGuardsAndReceipt;
  let changed = false;
  vi.spyOn(FileSystemService.prototype, 'writeNoteWithRevisionGuardsAndReceipt').mockImplementation(async function(params, guards, policy) {
    if (params.path.startsWith('_whispers/research/') && !changed) {
      changed = true;
      const parent = await fs.readNote('Community/Workshops/research.md');
      await fs.writeNote({ path: 'Community/Workshops/research.md', content: parent.content + '\nExternal revision', frontmatter: parent.frontmatter, expectedRevision: parent.revision });
    }
    return original.call(this, params, guards, policy);
  });
  await expect(update('close', current.revision, 'owner', { closure: { outcome: 'unresolved', explanation: 'Close remaining work' } })).rejects.toThrow(/unavailable|changed|revision/i);
  expect(changed).toBe(true);
  expect((await fs.readNote('_whispers/research/research/first.md')).revision).toBe(current.revision);
});

test('independent submissions are private to their authors until an authorized explicit disclosure', async () => {
  const created = await createRound();
  const first = await update('submit', created.revision, 'owner', { submission: submission('HIDDEN-ALTERNATIVE-ALPHA') });
  expect(JSON.stringify(await read())).toContain('HIDDEN-ALTERNATIVE-ALPHA');
  expect(JSON.stringify(await read('peer'))).not.toContain('HIDDEN-ALTERNATIVE-ALPHA');
  await expect(read('outside')).rejects.toThrow(/unavailable|participant/i);
  expect(JSON.stringify(await call('workshop.read', { workshopId: 'research' }, 'peer'))).not.toContain('HIDDEN-ALTERNATIVE-ALPHA');
  expect(await call('wiki.search', { query: 'HIDDEN-ALTERNATIVE-ALPHA', semantic: false, maxChars: 2000 }, 'peer')).toEqual([]);
  await expect(call('notes.read', { path: '_whispers/research/research/first.md', maxChars: 2000 }, 'peer')).rejects.toThrow(/denied|private/i);
  await expect(call('notes.write', { path: '_whispers/research/research/first.md', content: 'forged disclosure', expectedRevision: first.revision }, 'owner')).rejects.toThrow(/denied|private/i);
  await expect(update('disclose', first.revision)).rejects.toThrow(/submit|waiting/i);
  const second = await update('submit', first.revision, 'peer', { submission: submission('HIDDEN-ALTERNATIVE-BETA') });
  expect(JSON.stringify(await read('owner'))).not.toContain('HIDDEN-ALTERNATIVE-BETA');
  await expect(update('disclose', second.revision, 'peer')).rejects.toThrow(/facilitator/i);
  const disclosed = await update('disclose', second.revision);
  expect(disclosed.phase).toBe('review');
  const peers = await read('peer');
  expect(JSON.stringify(peers)).toContain('HIDDEN-ALTERNATIVE-ALPHA');
  expect(JSON.stringify(peers)).toContain('HIDDEN-ALTERNATIVE-BETA');
  expect(JSON.stringify(peers)).not.toContain('_whispers/');
  expect(JSON.stringify(peers).length).toBeLessThanOrEqual(4000);
});

test('CAS, immutable submissions and retry keys preserve evidence instead of overwriting it', async () => {
  const created = await createRound();
  const attempts = await Promise.allSettled([
    update('submit', created.revision, 'owner', { submission: submission('FIRST') }),
    update('submit', created.revision, 'peer', { submission: submission('SECOND') }),
  ]);
  expect(attempts.filter(x => x.status === 'fulfilled')).toHaveLength(1);
  const winner = attempts[0].status === 'fulfilled' ? 'owner' : 'peer';
  const original = winner === 'owner' ? 'FIRST' : 'SECOND';
  const current = await read(winner);
  const retry = await update('submit', created.revision, winner, { submission: submission(original) });
  expect(retry.revision).toBe(current.revision);
  await expect(update('submit', current.revision, winner, { submission: submission('FORGED') })).rejects.toThrow(/request|retry|immutable/i);
});

test('private or changed sources cannot be disclosed as shared research evidence', async () => {
  const created = await createRound();
  await call('notes.write', { path: 'scope://agent/owner/secret.md', content: 'SECRET-SOURCE', expectedRevision: 'missing' });
  const secret = await call('notes.read', { path: 'scope://agent/owner/secret.md', maxChars: 1000 });
  for (const path of ['./_scopes/agents/owner/secret.md', 'Public/../_scopes/agents/owner/secret.md', './_scopes./agents/owner/secret.md']) {
    await expect(update('submit', created.revision, 'owner', { submission: { ...submission('candidate'), evidence: [{ path, revision: secret.revision }] } })).rejects.toThrow(/reference|scope|private|unavailable/i);
  }
  await expect(update('submit', created.revision, 'owner', { submission: { ...submission('candidate'), evidence: [{ path: 'scope://agent/owner/secret.md', revision: secret.revision }] } })).rejects.toThrow(/reference|scope|private|unavailable/i);
  await call('notes.write', { path: 'Evidence.md', content: 'Original observation', expectedRevision: 'missing' });
  const evidence = await call('notes.read', { path: 'Evidence.md', maxChars: 1000 });
  const a = await update('submit', created.revision, 'owner', { submission: { ...submission('HIDDEN-CHANGED-EVIDENCE-CANDIDATE'), evidence: [{ path: 'Evidence.md', revision: evidence.revision }] } });
  const b = await update('submit', a.revision, 'peer', { submission: submission('alternative') });
  await call('notes.write', { path: 'Evidence.md', content: 'Changed observation', expectedRevision: evidence.revision });
  await expect(update('disclose', b.revision)).rejects.toThrow(/reference|changed|unavailable/i);
  expect(JSON.stringify(await read('peer'))).not.toContain('HIDDEN-CHANGED-EVIDENCE-CANDIDATE');
});

test('equivalent public evidence paths deduplicate before disclosure guards', async () => {
  let current = await createRound();
  await call('notes.write', { path: 'Evidence.md', content: 'Observation', expectedRevision: 'missing' });
  const source = await call('notes.read', { path: 'Evidence.md', maxChars: 1000 });
  current = await update('submit', current.revision, 'owner', { submission: { ...submission('A'), evidence: [{ path: 'Evidence.md', revision: source.revision }] } });
  current = await update('submit', current.revision, 'peer', { submission: { ...submission('B'), evidence: [{ path: './Evidence.md', revision: source.revision }] } });
  expect((await update('disclose', current.revision)).phase).toBe('review');
});

test('disclosed peer fingerprints, independent challenges and synthesis survive server restart', async () => {
  let current = await createRound();
  current = await update('submit', current.revision, 'owner', { submission: submission('Explanation A') });
  current = await update('submit', current.revision, 'peer', { submission: submission('Counterexample B') });
  current = await update('disclose', current.revision);
  const packet = await read();
  const a = packet.items.find((x: any) => x.accountId === 'owner');
  const b = packet.items.find((x: any) => x.accountId === 'peer');
  const opinion = (target: any, disposition = 'challenge') => ({ targetAccountId: target.accountId, targetFingerprint: target.fingerprint, disposition, rationale: 'Condition B limits the explanation; retain unresolved uncertainty', evidence: [] });
  await expect(update('review', current.revision, 'owner', { review: opinion(a) })).rejects.toThrow(/self/i);
  await expect(update('review', current.revision, 'peer', { review: { ...opinion(a), targetFingerprint: '0'.repeat(64) } })).rejects.toThrow(/basis/i);
  await expect(update('close', current.revision, 'owner', { closure: { outcome: 'synthesis', explanation: 'Not reviewed yet' } })).rejects.toThrow(/review/i);
  current = await update('review', current.revision, 'peer', { review: opinion(a) });
  current = await update('review', current.revision, 'owner', { review: opinion(b, 'alternative') });
  current = await update('close', current.revision, 'owner', { closure: { outcome: 'synthesis', explanation: 'Retain B as a limitation on A, not consensus or approval.' } });
  expect(current.phase).toBe('closed');
  const before = await read('peer', { field: 'reviews' });
  expect(before.items).toHaveLength(2);
  await client.close(); await server.close();
  server = createServer(vault, { version: '1.0.0' });
  const [left, right] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: 'research-resumed', version: '1.0.0' });
  await Promise.all([client.connect(left), server.connect(right)]);
  delete tokens.peer;
  tokens.peer = (await call('auth.login', { accountId: 'peer', password: 'disposable-research-peer-password' }, 'peer')).accessToken;
  const after = await read('peer', { field: 'reviews' });
  expect(after.revision).toBe(before.revision);
  expect(after.items).toEqual(before.items);
  expect(after.closure.explanation).toContain('limitation');
});

test('bounded reads bind cursors to caller and revision without exposing embargoed peers', async () => {
  let current = await createRound();
  current = await update('submit', current.revision, 'owner', { submission: submission('Secret A') });
  const personal = await read('peer', { limit: 1 });
  expect(personal.total).toBe(0);
  expect(personal.cursor).toBeUndefined();
  current = await update('submit', current.revision, 'peer', { submission: submission('Secret B') });
  current = await update('disclose', current.revision);
  const first = await read('owner', { limit: 1, maxChars: 1600 });
  expect(first.cursor).toBeTruthy();
  expect(JSON.stringify(first).length).toBeLessThanOrEqual(1600);
  const second = await read('owner', { cursor: first.cursor, limit: 1, maxChars: 1600 });
  expect(second.items[0].accountId).not.toBe(first.items[0].accountId);
  await expect(read('peer', { cursor: first.cursor })).rejects.toThrow(/cursor/i);
  await update('close', current.revision, 'owner', { closure: { outcome: 'unresolved', explanation: 'Insufficient evidence, preserve alternatives.' } });
  await expect(read('owner', { cursor: first.cursor })).rejects.toThrow(/cursor/i);
});

test('unresolved closure before disclosure does not reveal peers and expiry never discloses', async () => {
  let current = await createRound();
  current = await update('submit', current.revision, 'owner', { submission: submission('STILL-EMBARGOED') });
  const later = Date.now() + 31 * 60 * 1000;
  vi.spyOn(Date, 'now').mockReturnValue(later);
  const expired = await read('peer');
  expect(expired.budgetExpired).toBe(true);
  expect(expired.phase).toBe('collecting');
  expect(expired.revision).toBe(current.revision);
  expect(JSON.stringify(expired)).not.toContain('STILL-EMBARGOED');
  vi.restoreAllMocks();
  await update('close', current.revision, 'owner', { closure: { outcome: 'unresolved', explanation: 'Participant unavailable; no automatic approval.' } });
  const result = await read('peer');
  expect(result.phase).toBe('closed');
  expect(JSON.stringify(result)).not.toContain('STILL-EMBARGOED');
  expect(result.items).toEqual([]);
});

test('read-only runtime refuses research writes without changing stored revision', async () => {
  const before = await createRound();
  await client.close(); await server.close();
  server = createServer(vault, { version: '1.0.0', readOnly: true });
  const [left, right] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: 'research-readonly', version: '1.0.0' });
  await Promise.all([client.connect(left), server.connect(right)]);
  delete tokens.owner;
  tokens.owner = (await call('auth.login', { accountId: 'owner', password: 'disposable-research-owner-password' })).accessToken;
  await expect(update('submit', before.revision, 'owner', { submission: submission('MUST-NOT-SAVE') })).rejects.toThrow(/read.only/i);
  expect((await read()).revision).toBe(before.revision);
});
