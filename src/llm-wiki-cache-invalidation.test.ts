import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { FileSystemService } from './filesystem.js';
import { ScopeAccessPolicy } from './scope-access.js';
import { ReferenceService } from './references.js';
import { LlmWikiService } from './llm-wiki.js';
import type { ScopePrincipal } from './scope-auth.js';
import { derivedCacheBudget } from './cache-budget.js';
import { VaultFileCatalog } from './vault-catalog.js';
import { VaultMetadataIndex } from './vault-index.js';
import { PathFilter } from './pathfilter.js';
import { FrontmatterHandler } from './frontmatter.js';

let root: string, fs: FileSystemService, access: ScopeAccessPolicy, wiki: LlmWikiService;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'mcpvault-wiki-cache-'));
  fs = new FileSystemService(root); access = new ScopeAccessPolicy();
  wiki = new LlmWikiService(fs, access, new ReferenceService(fs, access));
});
afterEach(async () => { vi.restoreAllMocks(); wiki.invalidate(); await rm(root, { recursive: true, force: true }); });
async function note(path: string, content = '---\nllm_wiki_type: knowledge\nnote_kind: atomic\n---\nGrounded note') {
  await mkdir(dirname(join(root, path)), { recursive: true }); await writeFile(join(root, path), content);
}
const change = (path: string) => (wiki.invalidate as any)([{ path, kind: 'upsert' }]);
const summary = (principal?: ScopePrincipal) => wiki.catalog(principal, { summaryOnly: true });

async function indexedFixture(run: (catalog: VaultFileCatalog) => Promise<void>) {
  const filter = new PathFilter(), parser = new FrontmatterHandler();
  const catalog = new VaultFileCatalog(root, filter);
  // Deliver real queued events through the read barrier, without OS timing.
  vi.spyOn(catalog as any, 'startWatcher').mockImplementation(() => undefined);
  vi.spyOn(catalog as any, 'scheduleFlush').mockImplementation(() => undefined);
  const index = new VaultMetadataIndex(root, filter, parser, catalog);
  vi.spyOn(index as any, 'startWatcher').mockImplementation(() => undefined);
  fs = new FileSystemService(root, filter, parser, undefined, index);
  wiki = new LlmWikiService(fs, access, new ReferenceService(fs, access));
  const unsubscribe = catalog.subscribeBatch(changes => wiki.invalidate(changes));
  try { await index.list(); await run(catalog); }
  finally { unsubscribe(); await index.close(); await catalog.close(); }
}

test.each(['full', 'summary', 'warm', 'reset'] as const)('catalog prepares queued metadata before the %s generation fence', async mode => {
  await note('Knowledge/A.md');
  await indexedFixture(async catalog => {
    if (mode === 'warm') expect((await summary()).total).toBe(1);
    await note('Knowledge/B.md');
    (catalog as any).onFilesystemEvent(mode === 'reset' ? 'Knowledge' : 'Knowledge/B.md');
    let delivered = false;
    const unsubscribe = catalog.subscribeBatch(() => { delivered = true; });
    const compute = (wiki as any).computeCatalog.bind(wiki);
    const observed = vi.spyOn(wiki as any, 'computeCatalog').mockImplementation(async (...args) => {
      expect(delivered).toBe(true); return compute(...args);
    });
    try {
      expect((await wiki.catalog(undefined, { summaryOnly: mode !== 'full' })).total).toBe(2);
      expect(observed).toHaveBeenCalledTimes(1);
    } finally { unsubscribe(); }
  });
});

test('catalog rejects authority drift while the metadata preparation barrier is pending', async () => {
  await note('Knowledge/A.md');
  await indexedFixture(async catalog => {
    let policy = 'before';
    vi.spyOn(access, 'documentPolicyFingerprint').mockImplementation(() => policy);
    const flush = catalog.flushPendingEvents.bind(catalog);
    vi.spyOn(catalog, 'flushPendingEvents').mockImplementationOnce(async () => {
      await flush(); policy = 'after';
    });
    await expect(summary()).rejects.toThrow(/changed|retry/i);
  });
});

test('an event delivered after metadata preparation still rejects a computed catalog', async () => {
  await note('Knowledge/A.md');
  await indexedFixture(async catalog => {
    const compute = (wiki as any).computeCatalog.bind(wiki);
    vi.spyOn(wiki as any, 'computeCatalog').mockImplementationOnce(async (...args) => {
      const result = await compute(...args);
      await note('Knowledge/B.md'); (catalog as any).onFilesystemEvent('Knowledge/B.md');
      await catalog.flushPendingEvents(); return result;
    });
    await expect(summary()).rejects.toThrow(/changed|retry/i);
  });
});

test('non-wiki edits check only changed metadata and retain a warm catalog summary', async () => {
  await note('Knowledge/A.md'); await note('Community/Posts/post.md', '---\nmcpvault_type: post\n---\nold');
  const compute = vi.spyOn(wiki as any, 'computeCatalog');
  const before = await summary();
  await note('Community/Posts/post.md', '---\nmcpvault_type: post\n---\nnew'); change('Community/Posts/post.md');
  const metadata = vi.spyOn(fs, 'readNoteMetadata');
  expect(await summary()).toEqual(before);
  expect(compute).toHaveBeenCalledTimes(1);
  expect(metadata.mock.calls.flatMap(call => [...call[0]])).toEqual(['Community/Posts/post.md']);
  await note('Community/Posts/post.md'); change('Community/Posts/post.md');
  expect((await summary()).total).toBe(2);
  expect(compute).toHaveBeenCalledTimes(2);
});

test('only dependent scopes lose cached lint and summary after a private edit', async () => {
  await note('_scopes/agents/alice/A.md'); await note('_scopes/agents/bob/B.md');
  const alice: ScopePrincipal = { accountId: 'alice', modelId: 'gpt', agentId: 'alice', role: 'agent' };
  const bob: ScopePrincipal = { accountId: 'bob', modelId: 'gpt', agentId: 'bob', role: 'agent' };
  const catalog = vi.spyOn(wiki as any, 'computeCatalog'), lint = vi.spyOn(wiki as any, 'computeLint');
  await summary(alice); await summary(bob); await wiki.lint(alice); await wiki.lint(bob);
  await note('_scopes/agents/alice/A.md', '---\nllm_wiki_type: knowledge\nnote_kind: project\n---\nChanged');
  change('_scopes/agents/alice/A.md');
  await summary(bob); await wiki.lint(bob);
  expect(catalog).toHaveBeenCalledTimes(2); expect(lint).toHaveBeenCalledTimes(2);
  expect((await summary(alice)).organization.noteKinds).toEqual({ project: 1 });
  await wiki.lint(alice);
  expect(catalog).toHaveBeenCalledTimes(3); expect(lint).toHaveBeenCalledTimes(3);
});

test('cached summary cannot expose counts after current access is revoked', async () => {
  await note('Knowledge/A.md');
  let allowed = true;
  vi.spyOn(access, 'canAccessPhysicalPath').mockImplementation(() => allowed);
  expect((await summary()).total).toBe(1);
  allowed = false;
  expect((await summary()).total).toBe(0);
});

test('a changed dependency and an unknown reset still invalidate summaries', async () => {
  await note('Knowledge/A.md');
  const compute = vi.spyOn(wiki as any, 'computeCatalog');
  await summary();
  await note('Knowledge/A.md', '---\nllm_wiki_type: knowledge\nnote_kind: project\n---\nChanged');
  change('Knowledge/A.md');
  expect((await summary()).organization.noteKinds).toEqual({ project: 1 });
  wiki.invalidate(); await summary();
  expect(compute).toHaveBeenCalledTimes(3);
});

test('an edit arriving during changed-metadata validation cannot reuse the old summary', async () => {
  await note('Knowledge/A.md'); await note('Other.md', 'ordinary prose');
  await summary(); change('Other.md');
  const read = fs.readNoteMetadata.bind(fs);
  vi.spyOn(fs, 'readNoteMetadata').mockImplementationOnce(async (...args) => {
    const result = await read(...args);
    await note('Other.md'); change('Other.md');
    return result;
  });
  expect((await summary()).total).toBe(2);
});

test('principal membership changes do not reuse another department summary', async () => {
  await note('Department.md');
  const principal: ScopePrincipal = { accountId: 'alice', modelId: 'gpt', agentId: 'alice', role: 'agent',
    enterprise: { mode: 'company', realmId: 'company', runtimeId: 'local', sharedMemoryEnabled: false, departmentIds: ['one'] } };
  vi.spyOn(access, 'canAccessPhysicalPath').mockImplementation((_path, caller) => caller?.enterprise?.departmentIds?.includes('one') === true);
  expect((await summary(principal)).total).toBe(1);
  principal.enterprise!.departmentIds = ['two'];
  expect((await summary(principal)).total).toBe(0);
});

test.each(['generation', 'access', 'policy'] as const)('computed and shared summaries reject %s changes before delivery', async reason => {
  await note('Knowledge/A.md');
  let allowed = true, policy = 'one';
  vi.spyOn(access, 'canAccessPhysicalPath').mockImplementation(() => allowed);
  vi.spyOn(access, 'documentPolicyFingerprint').mockImplementation(() => policy);
  let release!: () => void, captured!: () => void;
  const hold = new Promise<void>(resolve => { release = resolve; });
  const ready = new Promise<void>(resolve => { captured = resolve; });
  const compute = (wiki as any).computeCatalog.bind(wiki);
  vi.spyOn(wiki as any, 'computeCatalog').mockImplementationOnce(async (...args) => {
    const value = await compute(...args); captured(); await hold; return value;
  });
  const first = summary();
  await ready;
  const shared = summary();
  if (reason === 'generation') change('Knowledge/A.md');
  if (reason === 'access') allowed = false;
  if (reason === 'policy') policy = 'two';
  const settled = Promise.allSettled([first, shared]); release();
  const results = await settled;
  expect(results.map(result => result.status)).toEqual(['rejected', 'rejected']);
  for (const result of results) if (result.status === 'rejected') expect(String(result.reason)).toMatch(/changed|retry/i);
});

test('cache hit delivery rechecks generation after asynchronous validation', async () => {
  await note('Knowledge/A.md'); await summary();
  const validate = (wiki as any).summaryCacheCurrent.bind(wiki);
  vi.spyOn(wiki as any, 'summaryCacheCurrent').mockImplementationOnce(async (...args) => {
    const valid = await validate(...args); change('Knowledge/A.md'); return valid;
  });
  await expect(summary()).rejects.toThrow(/changed|retry/i);
});

test('policy changes during cache validation cannot publish a recomputation under the old key', async () => {
  await note('Knowledge/A.md');
  let policy = 'one';
  vi.spyOn(access, 'documentPolicyFingerprint').mockImplementation(() => policy);
  await summary();
  const validate = (wiki as any).summaryCacheCurrent.bind(wiki);
  vi.spyOn(wiki as any, 'summaryCacheCurrent').mockImplementationOnce(async (...args) => {
    await validate(...args); policy = 'two'; return false;
  });
  await expect(summary()).rejects.toThrow(/changed|retry/i);
});

test.runIf(process.platform === 'win32').each(['delete', 'demote'])('Windows mixed-case %s invalidates the actual catalog contributor', async operation => {
  await note('Knowledge/A.md');
  expect((await summary()).total).toBe(1);
  if (operation === 'delete') await rm(join(root, 'knowledge/a.md'));
  else await note('knowledge/a.md', 'ordinary prose');
  change('knowledge/a.md');
  expect((await summary()).total).toBe(0);
});

test('expired-session summary retention is bounded and participates in the shared memory budget', async () => {
  await note('Knowledge/A.md');
  for (let i = 0; i < 40; i++) {
    await summary({ accountId: 'alice', modelId: 'gpt', agentId: 'alice', role: 'agent', sessionId: `session-${i}` });
    change('Other.md');
  }
  expect((wiki as any).catalogSummaryCache.size).toBeLessThanOrEqual(32);
  const compute = vi.spyOn(wiki as any, 'computeCatalog');
  await summary();
  const reservation = derivedCacheBudget.reserveWork(derivedCacheBudget.workSnapshot().maxBytes);
  try { expect((wiki as any).catalogSummaryCache.size).toBe(0); }
  finally { reservation.release(); }
  expect((await summary()).total).toBe(1);
  expect(compute).toHaveBeenCalledTimes(2);
});

test('lint cache charges long collection Map keys and values even with no returned findings', async () => {
  for (let i = 0; i < 120; i++) await note(`Knowledge/Note-${i}.md`, `---\nllm_wiki_type: knowledge\nprimary_moc: short-${i}\n---\nNote`);
  const before = derivedCacheBudget.snapshot().totalBytes;
  await wiki.lint(undefined, 0);
  const shortBytes = derivedCacheBudget.snapshot().totalBytes - before;
  wiki.invalidate();
  for (let i = 0; i < 120; i++) await note(`Knowledge/Note-${i}.md`, `---\nllm_wiki_type: knowledge\nprimary_moc: long-${i}-${'x'.repeat(1000)}\n---\nNote`);
  await wiki.lint(undefined, 0);
  const longBytes = derivedCacheBudget.snapshot().totalBytes - before;
  expect(longBytes - shortBytes).toBeGreaterThan(120 * 1000 * 2);
});
