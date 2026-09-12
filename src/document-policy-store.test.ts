import { afterEach, expect, test } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DocumentPolicyStore, DOCUMENT_POLICY_PATH } from './document-policy-store.js';
import { DocumentAuthority } from './document-authority.js';

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'protected-policy-')); roots.push(root);
  await mkdir(join(root, '_wiki', '_policies'), { recursive: true });
  await mkdir(join(root, '_sources'));
  await writeFile(join(root, '_sources', 'raw.txt'), 'Original bytes\r\n');
  const rules = [{ path: '_sources/raw.txt', confidential: true, accountIds: ['alice', 'bob'] }, { path: 'B.md', accountIds: ['bob', 'carol'] }];
  const original = `---\ntype: protected-document-policy\nversion: 1\nrules: ${JSON.stringify(rules)}\n---\n# Human policy explanation\nPreserve this explanation.\n`;
  await writeFile(join(root, DOCUMENT_POLICY_PATH), original);
  const store = new DocumentPolicyStore(root); await store.refresh();
  return { root, store };
}

test('derived metadata inherits every source restriction without changing raw bytes or policy prose', async () => {
  const { root, store } = await fixture();
  expect(typeof (store as any).inherit, 'trusted monotonic inheritance operation').toBe('function');
  await (store as any).inherit('Knowledge.md', ['_sources/raw.txt', 'B.md'], (store as any).revision());
  const authority = new DocumentAuthority(store.rules());
  const actor = { accountId: 'alice', userId: 'owner', modelId: 'local', agentId: 'worker', role: 'agent' as const };
  expect(authority.canRead('Knowledge.md', actor, () => true)).toBe(false);
  expect(authority.canRead('Knowledge.md', { ...actor, accountId: 'bob' }, () => true)).toBe(true);
  expect(authority.canRead('Knowledge.md', { ...actor, accountId: 'bob' }, () => false)).toBe(false);
  expect(await readFile(join(root, '_sources', 'raw.txt'), 'utf8')).toBe('Original bytes\r\n');
  expect(await readFile(join(root, DOCUMENT_POLICY_PATH), 'utf8')).toContain('# Human policy explanation\nPreserve this explanation.');
  const restarted = new DocumentPolicyStore(root); await restarted.refresh();
  expect(new DocumentAuthority(restarted.rules()).canFlow('Knowledge.md', '_sources/raw.txt')).toBe(true);
});

test('inheritance is monotonic, revision checked and rejects ancestry cycles', async () => {
  const { root, store } = await fixture();
  expect(typeof (store as any).inherit).toBe('function');
  const before = (store as any).revision();
  await (store as any).inherit('Knowledge.md', ['_sources/raw.txt'], before);
  const current = (store as any).revision();
  await expect((store as any).inherit('Other.md', ['B.md'], before)).rejects.toThrow(/revision|changed/i);
  await expect((store as any).inherit('_sources/raw.txt', ['Knowledge.md'], current)).rejects.toThrow(/cycle|cyclic|original/i);
  await (store as any).inherit('Knowledge.md', ['B.md'], current);
  const combined = store.rules().find(rule => rule.path === 'knowledge.md')!;
  expect(combined.derivedFrom).toEqual(expect.arrayContaining(['_sources/raw.txt', 'b.md']));
  expect(await readFile(join(root, '_sources', 'raw.txt'), 'utf8')).toBe('Original bytes\r\n');
});

test('two store instances cannot lose one another\'s restriction updates', async () => {
  const { root, store } = await fixture();
  expect(typeof (store as any).inherit).toBe('function');
  const second = new DocumentPolicyStore(root); await second.refresh();
  const revision = (store as any).revision();
  const results = await Promise.allSettled([(store as any).inherit('A-derived.md', ['_sources/raw.txt'], revision),
    (second as any).inherit('B-derived.md', ['B.md'], revision)]);
  expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
  expect(results.filter(result => result.status === 'rejected')).toHaveLength(1);
  await store.refresh();
  expect(store.rules().filter(rule => rule.path.endsWith('-derived.md'))).toHaveLength(1);
});

test('already equivalent restrictions retain ancestry for future source-policy tightening', async () => {
  const { root, store } = await fixture();
  const path = join(root, DOCUMENT_POLICY_PATH);
  const writeRules = async (accounts: string[]) => writeFile(path, `---\ntype: protected-document-policy\nversion: 1\nrules: ${JSON.stringify([
    { path: '_sources/raw.txt', confidential: true, accountIds: accounts },
    ...store.rules().filter(rule => rule.path !== '_sources/raw.txt' && rule.path !== 'peer.md'),
    store.rules().find(rule => rule.path === 'peer.md') ?? { path: 'Peer.md', confidential: true, accountIds: ['alice', 'bob'] },
  ])}\n---\n`);
  await writeRules(['alice', 'bob']); await store.refresh();
  await store.inherit('Peer.md', ['_sources/raw.txt'], store.revision());
  await writeRules(['alice']); await store.refresh();
  expect(new DocumentAuthority(store.rules()).canRead('Peer.md', { accountId: 'bob', modelId: 'local', role: 'model' }, () => true)).toBe(false);
});
