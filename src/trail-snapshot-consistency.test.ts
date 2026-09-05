import { afterEach, expect, test, vi } from 'vitest';
import { mkdtemp, rm, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { FileSystemService } from './filesystem.js';
import { ScopeAccessPolicy } from './scope-access.js';
import { ReferenceService } from './references.js';
import { LlmWikiService } from './llm-wiki.js';

const vaults: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const vault of vaults.splice(0)) await rm(vault, { recursive: true, force: true }); });
async function fixture() {
  const vault = await mkdtemp(join(tmpdir(), 'mcpvault-trail-snapshot-'));
  vaults.push(vault);
  const fs = new FileSystemService(vault), access = new ScopeAccessPolicy();
  const wiki = new LlmWikiService(fs, access, new ReferenceService(fs, access));
  const write = (path: string, content = '# Note', frontmatter: Record<string, unknown> = {}) => fs.writeNote({ path, content, frontmatter });
  await write('Start.md', '[[Mid.md]]'); await write('Mid.md', '[[End.md]]'); await write('End.md');
  return { vault, fs, wiki, write };
}

test.each(['Start.md', 'Mid.md', 'End.md'].flatMap(path => ['revised', 'hidden', 'deleted'].map(change => ({ path, change }))))('trail rejects $path $change after graph capture', async ({ path, change }) => {
  const { vault, fs, wiki, write } = await fixture();
  const get = fs.getOutlinks.bind(fs);
  let changed = false;
  vi.spyOn(fs, 'getOutlinks').mockImplementation(async (...args) => {
    const result = await get(...args);
    if (args[0] === 'Mid.md' && !changed) {
      changed = true;
      if (change === 'deleted') await unlink(join(vault, path));
      else await write(path, 'PRIVATE-MARKER', change === 'hidden' ? { moderation_status: 'hidden' } : {});
    }
    return result;
  });
  await expect(wiki.trail(undefined, 'Start.md', 'End.md')).rejects.toThrow(/trail source changed or became unavailable/);
  expect(changed).toBe(true);
});

test('converging simple paths remain distinct while shared graph reads and final checks are deduplicated', async () => {
  const { fs, wiki, write } = await fixture();
  await write('Start.md', '[[A.md]]\n[[B.md]]');
  await write('A.md', '[[Start.md]]\n[[Mid.md]]');
  await write('B.md', '[[Mid.md]]');
  await write('Unrelated.md');
  const get = vi.spyOn(fs, 'getOutlinks');
  const read = fs.readNoteRevision.bind(fs);
  let active = 0, peak = 0;
  const checked: string[] = [];
  vi.spyOn(fs, 'readNoteRevision').mockImplementation(async path => {
    checked.push(path); active += 1; peak = Math.max(peak, active);
    try { return await read(path); } finally { active -= 1; }
  });
  const result = await wiki.trail(undefined, 'Start.md', 'End.md', 4, 8, 16000);
  expect(result.paths.map(path => path.nodes)).toEqual([
    ['Start.md', 'A.md', 'Mid.md', 'End.md'],
    ['Start.md', 'B.md', 'Mid.md', 'End.md'],
  ]);
  for (const path of ['Start.md', 'A.md', 'B.md', 'Mid.md']) expect(get.mock.calls.filter(call => call[0] === path)).toHaveLength(1);
  expect(checked.sort()).toEqual(['Start.md', 'A.md', 'B.md', 'Mid.md', 'End.md'].sort());
  expect(peak).toBeGreaterThan(1); expect(peak).toBeLessThanOrEqual(4);
  for (const path of result.paths) for (const edge of path.edges) expect(edge.sourceRevision).toMatch(/^[a-f0-9]{64}$/);
  expect(JSON.stringify(result).length).toBeLessThanOrEqual(16000);
});

test('a zero-hop trail validates the endpoint once without graph traversal', async () => {
  const { fs, wiki } = await fixture();
  const graph = vi.spyOn(fs, 'getOutlinks'), check = vi.spyOn(fs, 'readNoteRevision');
  const result = await wiki.trail(undefined, 'Start.md', 'Start.md');
  expect(result.paths).toEqual([{ nodes: ['Start.md'], edges: [], length: 0 }]);
  expect(graph).not.toHaveBeenCalled();
  expect(check.mock.calls).toEqual([['Start.md']]);
});

test('zero-hop mixed endpoint revisions fail rather than claiming a current route', async () => {
  const { fs, wiki, write } = await fixture();
  const read = fs.readNote.bind(fs);
  let changed = false;
  vi.spyOn(fs, 'readNote').mockImplementation(async path => {
    const note = await read(path);
    if (!changed && path === 'Start.md') { changed = true; await write(path, '# Revised'); }
    return note;
  });
  await expect(wiki.trail(undefined, 'Start.md', 'Start.md')).rejects.toThrow(/trail source changed or became unavailable/);
});

test('an empty route still checks endpoints without revalidating unrelated dead ends', async () => {
  const { fs, wiki, write } = await fixture();
  await write('Mid.md', '# Dead end');
  const check = vi.spyOn(fs, 'readNoteRevision');
  const result = await wiki.trail(undefined, 'Start.md', 'End.md');
  expect(result.paths).toEqual([]);
  expect(check.mock.calls.map(call => call[0]).sort()).toEqual(['End.md', 'Start.md']);
});

test('authorized private trails preserve public scope identities through snapshot checks', async () => {
  const { fs, wiki, write } = await fixture();
  const root = '_scopes/agents/worker/Root.md', end = '_scopes/models/codex/Model.md';
  await write(root, '[[Model]]'); await write(end, '# Shared model note');
  const result = await wiki.trail({ modelId: 'codex', agentId: 'worker' }, root, end);
  expect(result.paths[0]?.nodes).toEqual(['scope://agent/worker/Root.md', 'scope://model/codex/Model.md']);
  expect(result.paths[0]?.edges[0]?.sourceRevision).toBe((await fs.readNote(root)).revision);
  expect(JSON.stringify(result)).not.toContain('_scopes/');
});

test('graph capture errors do not expose internal paths or note contents', async () => {
  const { fs, wiki } = await fixture();
  vi.spyOn(fs, 'getOutlinks').mockRejectedValue(new Error('PRIVATE-MARKER E:/server/private.md'));
  await expect(wiki.trail(undefined, 'Start.md', 'End.md')).rejects.toThrow(/^A trail source changed or became unavailable; re-read the endpoints and retry\.$/);
});
