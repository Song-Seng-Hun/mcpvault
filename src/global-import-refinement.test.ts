import { createHash, createPrivateKey, sign } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile, stat, utimes, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { generateGlobalSyncSigningKeyPair, GlobalSyncReplica, type GlobalManifest, type GlobalRevisionWithContent } from './global-sync.js';

let root: string;
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'global-import-refinement-')); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

function fixture(count: number) {
  const pair = generateGlobalSyncSigningKeyPair();
  const privateKey = createPrivateKey(pair.privateKey);
  const signed = <T extends object>(value: T) => ({ ...value, signature: sign(null, Buffer.from(JSON.stringify(value)), privateKey).toString('base64url') });
  const revisions: GlobalRevisionWithContent[] = Array.from({ length: count }, (_, index) => {
    const content = `Approved note ${index}\n`;
    return { ...signed({ documentId: `Note${index}.md`, revisionId: `revision-${index}`, sequence: index + 1,
      operation: 'upsert' as const, contentHash: `sha256:${createHash('sha256').update(content).digest('hex')}`,
      byteLength: Buffer.byteLength(content), author: 'fixture', reason: 'reviewed', origin: 'fixture', createdAt: '2026-09-10T00:00:00Z' }), content };
  });
  const client = {
    getManifest: vi.fn(async (after = 0, limit = 100): Promise<GlobalManifest> => {
      const entries = revisions.slice(after, after + limit).map(({ documentId, revisionId, sequence, operation, contentHash }) =>
        ({ documentId, revisionId, sequence, operation, contentHash }));
      const cursor = entries.at(-1)?.sequence ?? after;
      return signed({ protocol: 'mcpvault-global-sync/v1' as const, hubId: 'fixture', cursor, latestSequence: count, entries, hasMore: cursor < count });
    }),
    getRevision: vi.fn(async (id: string) => revisions.find(r => r.revisionId === id)!),
  };
  const replica = () => new GlobalSyncReplica({ vaultPath: root, client, trustedPublicKey: pair.publicKey });
  return { client, replica, signed };
}

test('imports more than 100 signed entries through bounded sequential pages', async () => {
  const f = fixture(101);
  const r = await f.replica().pullPages();
  expect(r).toMatchObject({ status: 'complete', cursor: 101, hasMore: false, pages: 2, appliedListComplete: true });
  expect(r.applied).toHaveLength(101);
  expect(f.client.getManifest.mock.calls).toEqual([[0, 100], [100, 100]]);
  expect(await readFile(join(root, 'Note100.md'), 'utf8')).toContain('100');
});

test('page budget is partial and restart resumes the durable cursor', async () => {
  const f = fixture(3);
  expect(await f.replica().pullPages(1, 2)).toMatchObject({ status: 'partial', cursor: 2, hasMore: true, pages: 1 });
  expect(await f.replica().pullPages(1, 2)).toMatchObject({ status: 'complete', cursor: 3, applied: ['Note2.md'] });
});

test('dirty local conflict stops without overwrite or looping', async () => {
  const f = fixture(3);
  await writeFile(join(root, 'Note1.md'), 'Local work');
  const r = await f.replica().pullPages();
  expect(r).toMatchObject({ status: 'conflict', cursor: 1, hasMore: true, pages: 1 });
  expect(r.conflicts[0]?.documentId).toBe('Note1.md');
  expect(f.client.getManifest).toHaveBeenCalledOnce();
  expect(await readFile(join(root, 'Note1.md'), 'utf8')).toBe('Local work');
});

test('interruption reports durable progress without claiming a complete applied list; restart continues', async () => {
  const f = fixture(3); const get = f.client.getRevision.getMockImplementation()!;
  f.client.getRevision.mockImplementation(async id => { if (id === 'revision-1') throw Error('PRIVATE_TOKEN'); return get(id); });
  const r = await f.replica().pullPages();
  expect(r).toMatchObject({ status: 'interrupted', cursor: 1, hasMore: true, appliedListComplete: false });
  expect(JSON.stringify(r)).not.toContain('PRIVATE_TOKEN');
  f.client.getRevision.mockImplementation(get);
  expect(await f.replica().pullPages()).toMatchObject({ status: 'complete', cursor: 3, applied: ['Note1.md', 'Note2.md'] });
});
test.each([0, 1])('same replica retries from durable progress after checkpoint persistence fails (%i saved)', async saved => {
  const f = fixture(3), replica = f.replica();
  const save = (replica as any).save.bind(replica);
  const persistence = vi.spyOn(replica as any, 'save');
  if (saved) persistence.mockImplementationOnce(() => save());
  persistence.mockRejectedValueOnce(Error('Disk temporarily unavailable')).mockImplementation(() => save());
  expect(await replica.pullPages()).toMatchObject({ status: 'interrupted', cursor: saved, appliedListComplete: false });
  expect(await replica.pullPages()).toMatchObject({ status: 'complete', cursor: 3, applied: ['Note0.md', 'Note1.md', 'Note2.md'].slice(saved) });
  expect(f.client.getManifest.mock.calls).toEqual([[0, 100], [saved, 100]]);
});

test.each([true, false])('signed empty nonterminal manifest cannot report completion or loop (hasMore=%s)', async hasMore => {
  const f = fixture(0);
  f.client.getManifest.mockResolvedValue(f.signed({ protocol: 'mcpvault-global-sync/v1', hubId: 'fixture', cursor: 0, latestSequence: 1, entries: [], hasMore }));
  expect(await f.replica().pullPages()).toMatchObject({ status: 'stalled', cursor: 0, hasMore: true, pages: 1 });
  expect(f.client.getManifest).toHaveBeenCalledOnce();
});

test.each([0, 11, 1.5, NaN])('rejects an unsafe page budget %s before requests', async budget => {
  const f = fixture(0);
  await expect(f.replica().pullPages(budget)).rejects.toThrow(/pages/i);
  expect(f.client.getManifest).not.toHaveBeenCalled();
});

test.each(['replace', 'tombstone', 'same-bytes'] as const)('a trusted signed import cannot mutate an existing original (%s)', async operation => {
  const f = fixture(0), documentId = '_sources/raw.md', content = '# Exact original\r\n';
  const hash = (value: string) => `sha256:${createHash('sha256').update(value).digest('hex')}`;
  let revision: GlobalRevisionWithContent;
  const publish = (sequence: number, body?: string) => {
    const header = { documentId, revisionId: `source-${sequence}`, sequence, ...(sequence > 1 && { parentRevision: `source-${sequence - 1}` }),
      operation: body === undefined ? 'tombstone' as const : 'upsert' as const,
      ...(body !== undefined && { contentHash: hash(body) }), byteLength: body === undefined ? 0 : Buffer.byteLength(body),
      author: 'fixture', reason: 'reviewed', origin: 'fixture', createdAt: '2026-09-10T00:00:00Z' };
    revision = { ...f.signed(header), ...(body !== undefined && { content: body }) };
    f.client.getRevision.mockImplementation(async () => revision);
    f.client.getManifest.mockImplementation(async () => f.signed({ protocol: 'mcpvault-global-sync/v1', hubId: 'fixture', cursor: sequence,
      latestSequence: sequence, entries: [{ documentId, revisionId: header.revisionId, sequence, operation: header.operation,
        ...(header.parentRevision && { parentRevision: header.parentRevision }), ...(body !== undefined && { contentHash: hash(body) }) }], hasMore: false }));
  };
  publish(1, content);
  expect((await f.replica().pull()).applied).toEqual([documentId]);
  const path = join(root, documentId);
  await utimes(path, new Date('2020-01-01'), new Date('2020-01-01'));
  const before = await stat(path);
  publish(2, operation === 'tombstone' ? undefined : operation === 'replace' ? '# Replacement' : content);
  const result = await f.replica().pull();
  if (operation !== 'same-bytes') expect(result.conflicts).toHaveLength(1);
  expect(await readFile(path, 'utf8')).toBe(content);
  expect((await stat(path)).mtimeMs).toBe(before.mtimeMs);
});

test.each(['proposeLocal', 'proposeTombstone'] as const)('Global %s cannot export confidential content or existence', async method => {
  const f = fixture(0);
  const submit = vi.fn(async () => ({ status: 'submitted' }));
  Object.assign(f.client, { submitProposal: submit });
  await mkdir(join(root, '_wiki', '_policies'), { recursive: true });
  await writeFile(join(root, '_wiki', '_policies', 'documents.md'), `---\ntype: protected-document-policy\nversion: 1\nrules: [{path: Secret.md, confidential: true}]\n---\n`);
  await writeFile(join(root, 'Secret.md'), 'PRIVATE_EXPORT_BODY');
  await expect(f.replica()[method]('Secret.md', 'author', 'reason', 'origin')).rejects.toThrow(/protected|confidential|public|denied/i);
  expect(submit).not.toHaveBeenCalled();
});

test('Global export rejects a public-looking junction into a confidential folder', async () => {
  const f = fixture(0), submit = vi.fn(async () => ({ status: 'submitted' }));
  Object.assign(f.client, { submitProposal: submit });
  await mkdir(join(root, 'Restricted'));
  await mkdir(join(root, '_wiki', '_policies'), { recursive: true });
  await writeFile(join(root, 'Restricted', 'Secret.md'), 'PRIVATE_EXPORT_BODY');
  await writeFile(join(root, '_wiki', '_policies', 'documents.md'), '---\ntype: protected-document-policy\nversion: 1\nrules: [{path: Restricted, recursive: true, confidential: true}]\n---\n');
  await symlink(join(root, 'Restricted'), join(root, 'Alias'), 'junction');
  await expect(f.replica().proposeLocal('Alias/Secret.md', 'author', 'reason', 'origin')).rejects.toThrow(/protected|confidential|public|denied|alias/i);
  expect(submit).not.toHaveBeenCalled();
});
