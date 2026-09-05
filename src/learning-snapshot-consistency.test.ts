import { afterEach, expect, test, vi } from 'vitest';
import { mkdtemp, rm, unlink, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { tmpdir } from 'node:os';
import { FileSystemService } from './filesystem.js';
import { ScopeAccessPolicy } from './scope-access.js';
import { ReferenceService } from './references.js';
import { LlmWikiService } from './llm-wiki.js';
import { ContinuityService } from './continuity.js';
import { VaultMetadataIndex } from './vault-index.js';
import { PathFilter } from './pathfilter.js';
import { FrontmatterHandler } from './frontmatter.js';
import { VaultIoCoordinator } from './vault-io.js';

const vaults: string[] = [];
const indexes: VaultMetadataIndex[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const index of indexes.splice(0)) index.close(); for (const vault of vaults.splice(0)) await rm(vault, { recursive: true, force: true }); });

test.each(['nested-hidden', 'nested-revised', 'leaf-hidden', 'leaf-deleted', 'external-revised', 'root-hidden', 'root-revised'].flatMap(change => [false, true].map(checkpoint => ({ change, checkpoint }))))('learning rejects $change after metadata capture (checkpoint=$checkpoint)', async ({ change, checkpoint }) => {
  const vault = await mkdtemp(join(tmpdir(), 'mcpvault-learning-snapshot-'));
  vaults.push(vault);
  const fs = new FileSystemService(vault), access = new ScopeAccessPolicy();
  const wiki = new LlmWikiService(fs, access, new ReferenceService(fs, access));
  const atomic = { note_kind: 'atomic', llm_wiki_type: 'knowledge' };
  await fs.writeNote({ path: 'MOC.md', content: '# Map\n[[A.md]]\n[[Nested.md]]\n', frontmatter: { ...atomic, note_kind: 'moc' } });
  await fs.writeNote({ path: 'A.md', content: '# A\n', frontmatter: { ...atomic, depends_on: ['[[External.md]]'] } });
  await fs.writeNote({ path: 'External.md', content: '# External\n', frontmatter: atomic });
  await fs.writeNote({ path: 'Nested.md', content: '# Nested\n[[Child.md]]\n', frontmatter: { ...atomic, note_kind: 'moc' } });
  await fs.writeNote({ path: 'Child.md', content: '# Child\n', frontmatter: atomic });
  const continuity = new ContinuityService(fs, { access, buildLearningPath: (p, path, depth, limit, chars) => wiki.learningPath(p, path, depth, limit, chars, true) });
  const principal = { accountId: 'reader', modelId: 'codex', agentId: 'worker', role: 'agent' as const };
  const previous = checkpoint ? await continuity.save({ principal, topic: 'Existing work', summary: 'Retain this work', nextAction: 'Read map' }) : undefined;
  const original = fs.queryNotes.bind(fs);
  let changed = false;
  vi.spyOn(fs, 'queryNotes').mockImplementation(async (...args) => {
    const result = await original(...args);
    if (!changed) {
      changed = true;
      const path = change.startsWith('root') ? 'MOC.md' : change.startsWith('nested') ? 'Nested.md' : change.startsWith('external') ? 'External.md' : 'A.md';
      if (change === 'leaf-deleted') await unlink(join(vault, path));
      else await fs.writeNote({ path, content: '# PRIVATE-MARKER\n[[PRIVATE-LINK]]\n', frontmatter: { ...atomic, ...(change.startsWith('nested') && { note_kind: 'moc' }), ...(change.endsWith('hidden') && { moderation_status: 'hidden' }) } });
    }
    return result;
  });
  let failure: unknown;
  try {
    if (checkpoint) {
      await continuity.save({ principal, topic: 'Learn', summary: 'Selected A', nextAction: 'Continue', learningProgress: { rootPath: 'MOC.md' }, expectedRevision: previous!.revision });
    } else await wiki.learningPath(undefined, 'MOC.md', 2, 30, 16000);
  } catch (error) { failure = error; }
  expect(changed).toBe(true);
  expect(failure).toBeInstanceOf(Error);
  expect((failure as Error).message).toMatch(change.startsWith('root') ? /root MOC changed/ : /source changed or became unavailable/);
  expect((failure as Error).message).not.toContain('PRIVATE');
  if (previous) expect((await fs.readNote('_scopes/agents/worker/_continuity/work-state.md')).revision).toBe(previous.revision);
  else expect(await fs.exists('_scopes/agents/worker/_continuity/work-state.md')).toBe(false);
});

test.each([false, true])('revalidation reads selected sources once and ignores unrelated edits (indexed=%s)', async indexed => {
  const vault = await mkdtemp(join(tmpdir(), 'mcpvault-learning-snapshot-'));
  vaults.push(vault);
  const index = indexed ? new VaultMetadataIndex(vault, new PathFilter(), new FrontmatterHandler()) : undefined;
  if (index) indexes.push(index);
  const handler = new FrontmatterHandler(), io = new VaultIoCoordinator();
  const fs = new FileSystemService(vault, undefined, handler, undefined, index, undefined, io), access = new ScopeAccessPolicy();
  const wiki = new LlmWikiService(fs, access, new ReferenceService(fs, access));
  const paths = Array.from({ length: 12 }, (_, i) => `Entry-${i}.md`);
  await fs.writeNote({ path: 'MOC.md', content: '# Map\n' + paths.map(path => `[[${path}]]`).join('\n'), frontmatter: { note_kind: 'moc', llm_wiki_type: 'knowledge' } });
  for (const path of [...paths, 'External.md', 'Unrelated.md']) await fs.writeNote({ path, content: '# Entry\n', frontmatter: { note_kind: 'atomic', llm_wiki_type: 'knowledge', ...(paths.includes(path) && { depends_on: ['[[External.md]]'] }) } });
  const query = fs.queryNotes.bind(fs), read = io.readUtf8.bind(io);
  const parse = vi.spyOn(handler, 'parse');
  let captured = false, active = 0, peak = 0;
  const reads: string[] = [];
  vi.spyOn(fs, 'queryNotes').mockImplementation(async (...args) => {
    const result = await query(...args);
    if (!captured) await writeFile(join(vault, 'Unrelated.md'), '# Changed unrelated note\n');
    captured = true;
    parse.mockClear();
    return result;
  });
  vi.spyOn(io, 'readUtf8').mockImplementation(async path => {
    if (!captured) return read(path);
    reads.push(basename(path)); active += 1; peak = Math.max(peak, active);
    try { return await read(path); } finally { active -= 1; }
  });
  const result = await wiki.learningPath(undefined, 'MOC.md', 2, 30, 16000, true);
  expect(result.authoredOrder.map(item => item.path)).toEqual(paths);
  expect(peak).toBeLessThanOrEqual(4);
  expect(peak).toBeGreaterThan(1);
  for (const path of [...paths, 'External.md']) expect(reads.filter(item => item === path)).toHaveLength(1);
  expect(reads.filter(item => item === 'MOC.md')).toHaveLength(1);
  expect(reads).not.toContain('Unrelated.md');
  expect(parse).not.toHaveBeenCalled();
});

test.each(['A.md', 'MOC.md'])('learning refuses access revoked during final raw read of %s', async target => {
  const vault = await mkdtemp(join(tmpdir(), 'mcpvault-learning-snapshot-'));
  vaults.push(vault);
  const io = new VaultIoCoordinator(), access = new ScopeAccessPolicy();
  const fs = new FileSystemService(vault, undefined, undefined, undefined, undefined, undefined, io);
  const wiki = new LlmWikiService(fs, access, new ReferenceService(fs, access));
  await fs.writeNote({ path: 'MOC.md', content: '[[A.md]]', frontmatter: { note_kind: 'moc' } });
  await fs.writeNote({ path: 'A.md', content: '# A' });
  const query = fs.queryNotes.bind(fs), rawRead = io.readUtf8.bind(io);
  const canAccess = access.canAccessPhysicalPath.bind(access);
  let captured = false, revoked = false;
  vi.spyOn(fs, 'queryNotes').mockImplementation(async (...args) => {
    const result = await query(...args);
    captured = true;
    return result;
  });
  vi.spyOn(access, 'canAccessPhysicalPath').mockImplementation((path, principal) =>
    !(revoked && path === target) && canAccess(path, principal));
  vi.spyOn(io, 'readUtf8').mockImplementation(async (...args) => {
    const result = await rawRead(...args);
    if (captured && basename(args[0]) === target) revoked = true;
    return result;
  });
  await expect(wiki.learningPath(undefined, 'MOC.md')).rejects.toThrow(
    target === 'MOC.md' ? /root MOC changed/ : /source changed or became unavailable/);
  expect(revoked).toBe(true);
});
