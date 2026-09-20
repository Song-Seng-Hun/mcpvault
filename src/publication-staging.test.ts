import { afterEach, expect, test } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DocumentAuthority } from './document-authority.js';
import { DocumentPolicyStore, DOCUMENT_POLICY_PATH } from './document-policy-store.js';
import * as storageContext from './enterprise-storage-context.js';
import { ScopeAccessPolicy } from './scope-access.js';
import { FileSystemService } from './filesystem.js';

const held = 'a'.repeat(64), roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
test('pending publication is hidden even from an otherwise authorized administrator', () => {
  let authority: DocumentAuthority | undefined;
  expect(() => { authority = new DocumentAuthority([{ path: 'Parts', recursive: true, publicationHold: held } as any]); }).not.toThrow();
  for (const principal of [undefined, { accountId: 'admin', modelId: 'local', role: 'admin' as const }]) {
    expect(authority!.canRead('Parts/chapter.md', principal, () => true)).toBe(false);
  }
  expect(authority!.canFlow('Public.md', 'Parts/chapter.md')).toBe(false);
});

test('publication holds survive restart and release only the owned hold, never inherited restrictions', async () => {
  const root = await mkdtemp(join(tmpdir(), 'publication-hold-')); roots.push(root);
  await mkdir(join(root, '_wiki', '_policies'), { recursive: true });
  await writeFile(join(root, DOCUMENT_POLICY_PATH), '---\ntype: protected-document-policy\nversion: 1\nrules: [{path: Source.md, accountIds: [alice]}]\n---\nPolicy explanation.\n');
  const store = new DocumentPolicyStore(root); await store.refresh();
  expect(typeof (store as any).beginPublication).toBe('function');
  await (store as any).beginPublication('Parts', ['Source.md'], held, store.revision());
  const restarted = new DocumentPolicyStore(root); await restarted.refresh();
  const alice: any = { accountId: 'alice', modelId: 'local', role: 'agent' };
  expect(new DocumentAuthority(restarted.rules()).canRead('Parts/chapter.md', alice)).toBe(false);
  await expect((restarted as any).finishPublication('Parts', 'b'.repeat(64), restarted.revision())).rejects.toThrow();
  await (restarted as any).finishPublication('Parts', held, restarted.revision());
  const authority = new DocumentAuthority(restarted.rules());
  expect(authority.canRead('Parts/chapter.md', alice)).toBe(true);
  expect(authority.canRead('Parts/chapter.md', { ...alice, accountId: 'bob' })).toBe(false);
  expect(authority.canFlow('Parts/chapter.md', 'Source.md')).toBe(true);
  const releasedRule = restarted.rules().find(r => r.path === 'parts')!;
  await (restarted as any).holdPublished('Parts', held, releasedRule, restarted.revision());
  expect(new DocumentAuthority(restarted.rules()).canRead('Parts/chapter.md', alice)).toBe(false);
  await (restarted as any).finishPublication('Parts', held, restarted.revision());
  expect(await readFile(join(root, DOCUMENT_POLICY_PATH), 'utf8')).toContain('Policy explanation.');
  await expect((restarted as any).beginPublication('Parts', ['Source.md'], held, restarted.revision())).rejects.toThrow();
});

test('inherited directory source restrictions do not create redundant per-chapter policy mutations', async () => {
  const root = await mkdtemp(join(tmpdir(), 'publication-inherit-')); roots.push(root);
  await mkdir(join(root, '_wiki', '_policies'), { recursive: true });
  await writeFile(join(root, DOCUMENT_POLICY_PATH), '---\ntype: protected-document-policy\nversion: 1\nrules: []\n---\n');
  const store = new DocumentPolicyStore(root); await store.refresh();
  await store.beginPublication('Parts', ['Source.md'], held, store.revision());
  const revision = store.revision();
  await store.inherit('Parts/A.md', ['Source.md'], revision);
  expect(store.revision()).toBe(revision);
});

test('owner staging reads are exact-path, request-local and cannot bypass current source authority', async () => {
  const stage = (storageContext as any).withPublicationStaging;
  expect(typeof stage).toBe('function');
  const authority = new DocumentAuthority([{ path: 'Parts', recursive: true, publicationHold: held, accountIds: ['alice'] }]);
  const alice: any = { accountId: 'alice', modelId: 'local', role: 'agent' };
  const read = (path = 'Parts/A.md', actor = alice) => authority.canRead(path, actor);
  let later!: () => boolean;
  await stage(held, ['Parts/A.md'], async () => {
    expect(read()).toBe(true);
    expect(read('Parts/B.md')).toBe(false);
    expect(read('Parts/A.md', { ...alice, accountId: 'bob' })).toBe(false);
    await stage(held, ['Parts/A.md', 'Parts/B.md'], async () => expect(read('Parts/B.md')).toBe(false));
    await stage('b'.repeat(64), ['Parts/A.md'], async () => expect(read()).toBe(false));
    const { AsyncResource } = await import('node:async_hooks');
    later = AsyncResource.bind(() => read());
  });
  expect(read()).toBe(false);
  expect(later()).toBe(false);
});

test('pending chapter directory names do not leak through ordinary directory navigation', async () => {
  const root = await mkdtemp(join(tmpdir(), 'publication-list-')); roots.push(root);
  await mkdir(join(root, 'Parts')); await writeFile(join(root, 'Parts', 'A.md'), 'Private pending content.');
  const access = new ScopeAccessPolicy({ documentRules: () => [{ path: 'Parts', recursive: true, publicationHold: held }] });
  const fs = new FileSystemService(root);
  await storageContext.withEnterpriseStorageContext({ access, assertFresh: access.captureDocumentBoundary() }, async () => {
    expect((await fs.listDirectory()).directories).not.toContain('Parts');
    await expect(fs.listDirectory('Parts')).rejects.toThrow();
    await expect(fs.readNote('Parts/A.md')).rejects.toThrow();
  });
});
