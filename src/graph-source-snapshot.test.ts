import { afterEach, expect, test, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { FileSystemService } from './filesystem.js';
import { VaultGraphIndex } from './vault-graph.js';
import { PathFilter } from './pathfilter.js';
import { FrontmatterHandler } from './frontmatter.js';

const fixtures: Array<{ vault: string; graph: VaultGraphIndex }> = [];
afterEach(async () => { vi.restoreAllMocks(); for (const { vault, graph } of fixtures.splice(0)) { graph.close(); await rm(vault, { recursive: true, force: true }); } });
async function fixture() {
  const vault = await mkdtemp(join(tmpdir(), 'mcpvault-graph-source-'));
  const graph = new VaultGraphIndex(vault, new PathFilter(), new FrontmatterHandler());
  fixtures.push({ vault, graph });
  // Deliberately simulate a missing watcher without faking parsed graph data.
  vi.spyOn(graph as any, 'startWatcher').mockImplementation(() => {});
  const fs = new FileSystemService(vault, undefined, undefined, undefined, undefined, graph);
  await writeFile(join(vault, 'Root.md'), '# Root\n[[Target]]');
  await writeFile(join(vault, 'Target.md'), '# Target');
  await fs.getOutlinks('Root.md');
  return { vault, graph, fs };
}

test.each([false, true])('outlinks reject an old graph body and repair the cache on retry (revisions=%s)', async includeSourceRevision => {
  const { vault, graph, fs } = await fixture();
  const freeze = vi.spyOn(graph as any, 'ensure').mockResolvedValue(undefined);
  await writeFile(join(vault, 'Root.md'), '# Root\nLinks removed');
  await expect(fs.getOutlinks('Root.md', 10, () => true, 0, { includeSourceRevision })).rejects.toThrow(/Graph.*changed|Graph.*stale/i);
  freeze.mockRestore();
  expect((await fs.getOutlinks('Root.md')).total).toBe(0);
});

test.each([false, true])('backlinks reject stale author context before counts and pagination (revisions=%s)', async includeSourceRevision => {
  const { vault, graph, fs } = await fixture();
  const freeze = vi.spyOn(graph as any, 'ensure').mockResolvedValue(undefined);
  await writeFile(join(vault, 'Root.md'), '# Root\nCitation removed');
  await expect(fs.getBacklinks('Target.md', 1, () => true, 1, { includeSourceRevision })).rejects.toThrow(/Graph.*changed|Graph.*stale/i);
  freeze.mockRestore();
  expect((await fs.getBacklinks('Target.md')).total).toBe(0);
});

test('backlinks reject a target revision different from the graph snapshot', async () => {
  const { vault, graph, fs } = await fixture();
  vi.spyOn(graph as any, 'ensure').mockResolvedValue(undefined);
  await writeFile(join(vault, 'Target.md'), '# Renamed identity\n');
  await expect(fs.getBacklinks('Target.md')).rejects.toThrow(/Graph.*changed|Graph.*stale/i);
});

test.each(['getOutlinks', 'getBacklinks'] as const)('%s rejects a root changed after the graph read', async method => {
  const { vault, graph, fs } = await fixture();
  const read = graph[method].bind(graph);
  vi.spyOn(graph, method).mockImplementation(async (...args) => {
    const result = await read(...args);
    await writeFile(join(vault, method === 'getOutlinks' ? 'Root.md' : 'Target.md'), '# Changed after graph capture');
    return result as any;
  });
  await expect(fs[method](method === 'getOutlinks' ? 'Root.md' : 'Target.md')).rejects.toThrow(/Graph.*changed|Graph.*stale/i);
});

test.each(['edited', 'hidden', 'deleted'] as const)('backlinks revalidate returned authors %s after graph capture', async change => {
  const { vault, graph, fs } = await fixture();
  const read = graph.getBacklinks.bind(graph);
  vi.spyOn(graph, 'getBacklinks').mockImplementation(async (...args) => {
    const result = await read(...args);
    if (change === 'deleted') await rm(join(vault, 'Root.md'));
    else await writeFile(join(vault, 'Root.md'), change === 'hidden' ? '---\nmoderation_status: hidden\n---\n[[Target]]' : '# Edited author');
    return result;
  });
  await expect(fs.getBacklinks('Target.md')).rejects.toThrow(/Graph source changed or became unavailable/);
});

test('validation is mandatory internally while revision response fields stay opt-in', async () => {
  const { fs } = await fixture();
  const plainOut = await fs.getOutlinks('Root.md');
  const plainBack = await fs.getBacklinks('Target.md');
  expect(plainOut).not.toHaveProperty('sourceRevision');
  expect(plainBack).not.toHaveProperty('targetRevision');
  expect(plainBack.backlinks[0]).not.toHaveProperty('sourceRevision');
  const detailed = await fs.getBacklinks('Target.md', 10, () => true, 0, { includeSourceRevision: true, includeSnapshot: true });
  expect(detailed.targetRevision).toBe(await fs.readNoteRevision('Target.md'));
  expect(detailed.backlinks[0]!.sourceRevision).toBe(await fs.readNoteRevision('Root.md'));
  expect(detailed.snapshotFingerprint).toMatch(/^[a-f0-9]{64}$/);
});

test('selected backlink authors are rechecked once per file rather than once per link', async () => {
  const { vault, graph, fs } = await fixture();
  await writeFile(join(vault, 'Root.md'), '[[Target]]\n[[Target]]\n[[Target]]');
  graph.invalidate('Root.md');
  const read = vi.spyOn(fs, 'readNoteRevision');
  expect((await fs.getBacklinks('Target.md')).total).toBe(3);
  expect(read.mock.calls.filter(([path]) => path === 'Root.md')).toHaveLength(1);
  expect(read.mock.calls.filter(([path]) => path === 'Target.md')).toHaveLength(1);
});

test.each(['getOutlinks', 'getBacklinks'] as const)('%s rejects destination permission changes during final hashing', async method => {
  const { fs } = await fixture();
  let visible = true;
  const canAccess = (path: string) => path !== 'Target.md' || visible;
  const read = fs.readNoteRevision.bind(fs);
  vi.spyOn(fs, 'readNoteRevision').mockImplementation(async path => {
    const revision = await read(path);
    if (path === 'Root.md') visible = false;
    return revision;
  });
  await expect(fs[method](method === 'getOutlinks' ? 'Root.md' : 'Target.md', 10, canAccess)).rejects.toThrow(/Graph.*changed|Graph.*visibility/i);
});

test('backlinks reject observed target hiding during final author hashing', async () => {
  const { vault, graph, fs } = await fixture();
  const read = fs.readNoteRevision.bind(fs);
  vi.spyOn(fs, 'readNoteRevision').mockImplementation(async path => {
    const revision = await read(path);
    if (path === 'Root.md') {
      await writeFile(join(vault, 'Target.md'), '---\nmoderation_status: hidden\n---\n# Hidden');
      graph.invalidate('Target.md');
    }
    return revision;
  });
  await expect(fs.getBacklinks('Target.md')).rejects.toThrow(/Graph.*changed/i);
});
