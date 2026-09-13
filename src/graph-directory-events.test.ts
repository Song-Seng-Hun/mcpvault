import { afterEach, expect, test, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { mkdtemp, mkdir, rm, writeFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { VaultGraphIndex } from './vault-graph.js';
import { VaultIoCoordinator } from './vault-io.js';
import { FrontmatterHandler } from './frontmatter.js';
import { PathFilter } from './pathfilter.js';

const events = vi.hoisted(() => ({ callback: undefined as undefined | ((event: string, file?: string) => void) }));
vi.mock('node:fs', async load => ({ ...await load<typeof import('node:fs')>(), watch: (_root: string, _options: unknown, callback: typeof events.callback) => {
  events.callback = callback; return Object.assign(new EventEmitter(), { close() {}, unref() {} });
} }));
let vault: string, graph: VaultGraphIndex;
afterEach(async () => { graph?.close(); vi.restoreAllMocks(); if (vault) await rm(vault, { recursive: true, force: true }); });
async function fixture() {
  vault = await mkdtemp(join(tmpdir(), 'graph-directory-events-')); await mkdir(join(vault, 'Notes'));
  for (let i = 0; i < 32; i++) await writeFile(join(vault, 'Notes', `N${i}.md`), i === 1 ? '[[Alias]]' : '# Note');
  const io = new VaultIoCoordinator(); graph = new VaultGraphIndex(vault, new PathFilter(), new FrontmatterHandler(), undefined, io);
  await graph.getBacklinks('Notes/N0.md', 10, () => true);
  return vi.spyOn(io, 'readUtf8Bounded');
}
test('known parent-directory change reconciles aliases and deletion without rereading unchanged bodies', async () => {
  const reads = await fixture(); await unlink(join(vault, 'Notes/N2.md')); graph.invalidate('Notes/N2.md', 'delete');
  events.callback!('change', 'Notes');
  await writeFile(join(vault, 'Notes/N0.md'), '---\naliases: [Alias]\n---\n# Note'); graph.invalidate('Notes/N0.md');
  const result = await graph.getBacklinks('Notes/N0.md', 10, () => true);
  expect(result.total).toBe(1); expect(result.backlinks[0]!.path).toBe('Notes/N1.md');
  expect(reads.mock.calls.map(([p]) => p)).toEqual([join(vault, 'Notes/N0.md')]);
});
test('known directory notification discovers new files without trusting only previous reverse links', async () => {
  const reads = await fixture(); await writeFile(join(vault, 'Notes/New.md'), '[[Notes/N0.md]]'); events.callback!('change', 'Notes');
  expect((await graph.getBacklinks('Notes/N0.md', 10, () => true)).total).toBe(1);
  expect(reads.mock.calls.map(([p]) => p)).toEqual([join(vault, 'Notes/New.md')]);
});
test.each([['change', undefined], ['rename', 'Notes'], ['change', 'Unknown']])('unknown/rename event keeps full content validation: %s %s', async (event, path) => {
  const reads = await fixture(); events.callback!(event!, path);
  await graph.getBacklinks('Notes/N0.md', 10, () => true); expect(reads.mock.calls.length).toBe(32);
});
test('known folder change cannot clear a pending forced full read', async () => {
  const reads = await fixture(); events.callback!('change', undefined); events.callback!('change', 'Notes');
  await graph.getBacklinks('Notes/N0.md', 10, () => true); expect(reads.mock.calls.length).toBe(32);
});
test('directory metadata reuse does not postpone the independent full content audit', async () => {
  const reads = await fixture(); let now = Date.now(); vi.spyOn(Date, 'now').mockImplementation(() => now);
  for (let i = 0; i < 14; i++) {
    now += 60000; events.callback!('change', 'Notes'); await graph.getBacklinks('Notes/N0.md', 10, () => true);
  }
  expect(reads.mock.calls.length).toBe(0);
  now += 120000; events.callback!('change', 'Notes'); await graph.getBacklinks('Notes/N0.md', 10, () => true);
  expect(reads.mock.calls.length).toBe(32);
});
test('alias refresh still uses current visibility, including an unchanged predicate closure', async () => {
  await fixture(); let allowed = true; const canRead = (path: string) => allowed || path !== 'Notes/N1.md';
  await writeFile(join(vault, 'Notes/N0.md'), '---\naliases: [Alias]\n---\n# Note'); graph.invalidate('Notes/N0.md');
  expect((await graph.getBacklinks('Notes/N0.md', 10, canRead)).total).toBe(1);
  allowed = false; events.callback!('change', 'Notes');
  const result = await graph.getBacklinks('Notes/N0.md', 10, canRead);
  expect(result.total).toBe(0); expect(JSON.stringify(result)).not.toContain('Notes/N1.md');
});
