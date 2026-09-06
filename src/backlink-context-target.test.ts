import { afterEach, expect, test, vi } from 'vitest';
import { mkdtemp, rm, truncate, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { FileSystemService, MAX_NOTE_CONTENT_BYTES } from './filesystem.js';
import { VaultIoCoordinator } from './vault-io.js';
import { VaultGraphIndex } from './vault-graph.js';
import { PathFilter } from './pathfilter.js';
import { FrontmatterHandler } from './frontmatter.js';

const fixtures: Array<{ vault: string; graph: VaultGraphIndex }> = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const { vault, graph } of fixtures.splice(0)) {
    graph.close(); await rm(vault, { recursive: true, force: true });
  }
});
async function fixture(hidden = false, headingOnly = false) {
  const vault = await mkdtemp(join(tmpdir(), 'mcpvault-backlink-context-'));
  await writeFile(join(vault, 'Root.md'), '# Root');
  await writeFile(join(vault, 'Author.md'), `## Related [[Neighbor]]\n[[Root]]${headingOnly ? '' : ' and [[Neighbor]]'}\n\n## Separate\n[[Unrelated]]`);
  await writeFile(join(vault, 'Neighbor.md'), `---\nmoderation_status: ${hidden ? 'hidden' : 'active'}\n---\n# Neighbor`);
  await writeFile(join(vault, 'Unrelated.md'), '# Unrelated');
  const graph = new VaultGraphIndex(vault, new PathFilter(), new FrontmatterHandler());
  fixtures.push({ vault, graph });
  vi.spyOn(graph as any, 'startWatcher').mockImplementation(() => {});
  const io = new VaultIoCoordinator();
  const fs = new FileSystemService(vault, undefined, undefined, undefined, undefined, graph, io);
  await fs.getBacklinks('Root.md');
  return { vault, graph, fs, io };
}

test.each([false, true])('backlinks reject newly hidden nearby targets before returning context (headingOnly=%s)', async headingOnly => {
  const { vault, fs } = await fixture(false, headingOnly);
  await writeFile(join(vault, 'Neighbor.md'), '---\nmoderation_status: hidden\n---\n# Neighbor');
  await expect(fs.getBacklinks('Root.md')).rejects.toThrow(/Graph.*changed/);
  const result = await fs.getBacklinks('Root.md');
  expect(result.total).toBe(1);
  expect(JSON.stringify(result)).not.toContain('Neighbor');
  expect(JSON.stringify(result)).toContain('[unavailable link]');
});

test('backlinks recover nearby references after a known target is unhidden', async () => {
  const { vault, fs } = await fixture(true);
  await writeFile(join(vault, 'Neighbor.md'), '# Neighbor');
  await expect(fs.getBacklinks('Root.md')).rejects.toThrow(/Graph.*changed/);
  expect(JSON.stringify(await fs.getBacklinks('Root.md'))).toContain('[[Neighbor]]');
});

test('off-page projection dependencies are checked for a complete result fingerprint', async () => {
  const { vault, graph, fs } = await fixture();
  await writeFile(join(vault, 'First.md'), '[[Root]]');
  graph.invalidate('First.md');
  await fs.getBacklinks('Root.md');
  await writeFile(join(vault, 'Neighbor.md'), '# Revised neighbor');
  await expect(fs.getBacklinks('Root.md', 1, () => true, 1, { includeSnapshot: true })).rejects.toThrow(/Graph.*changed/);
});

test('context target checks do not hash references in unrelated sections', async () => {
  const { fs } = await fixture();
  const reads = vi.spyOn(fs, 'readNoteRevision');
  expect((await fs.getBacklinks('Root.md')).total).toBe(1);
  expect(reads.mock.calls.filter(([path]) => path === 'Neighbor.md')).toHaveLength(1);
  expect(reads.mock.calls.some(([path]) => path === 'Unrelated.md')).toBe(false);
});

test('scope-denied neighbors are redacted without reading their bodies', async () => {
  const { fs } = await fixture();
  const reads = vi.spyOn(fs, 'readNoteRevision');
  const result = await fs.getBacklinks('Root.md', 10, path => path !== 'Neighbor.md');
  expect(result.total).toBe(1);
  expect(JSON.stringify(result)).not.toContain('Neighbor');
  expect(reads.mock.calls.some(([path]) => path === 'Neighbor.md')).toBe(false);
});

test.each([false, true])('scoped alias fallback observes hide/unhide despite a denied exact match (hidden=%s)', async hidden => {
  const { vault, graph, fs } = await fixture();
  const body = (hidden: boolean) => `---\naliases: [Neighbor]\nmoderation_status: ${hidden ? 'hidden' : 'active'}\n---\n# Actual`;
  await writeFile(join(vault, 'Actual.md'), body(hidden));
  graph.invalidate('Actual.md');
  const access = (path: string) => path !== 'Neighbor.md';
  await fs.getBacklinks('Root.md', 10, access);
  await writeFile(join(vault, 'Actual.md'), body(!hidden));
  const reads = vi.spyOn(fs, 'readNoteRevision');
  await expect(fs.getBacklinks('Root.md', 10, access)).rejects.toThrow(/Graph.*changed/);
  const fresh = JSON.stringify(await fs.getBacklinks('Root.md', 10, access));
  expect(fresh.includes('[[Neighbor]]')).toBe(hidden);
  expect(reads.mock.calls.some(([path]) => path === 'Neighbor.md')).toBe(false);
});

test('clipped context references still validate their full physical-line targets', async () => {
  const { vault, graph, fs } = await fixture();
  await writeFile(join(vault, 'Author.md'), `[[Root]] ${'x'.repeat(400)} [[Neighbor]]`);
  graph.invalidate('Author.md');
  await fs.getBacklinks('Root.md');
  await writeFile(join(vault, 'Neighbor.md'), '---\nmoderation_status: hidden\n---\n# Neighbor');
  await expect(fs.getBacklinks('Root.md')).rejects.toThrow(/Graph.*changed/);
  const fresh = await fs.getBacklinks('Root.md');
  expect(fresh.backlinks[0]!.context).toBe('[context omitted] [[Root]]');
});

test('oversized context targets fail through bounded I/O', async () => {
  const { vault, fs, io } = await fixture();
  await truncate(join(vault, 'Neighbor.md'), MAX_NOTE_CONTENT_BYTES + 1);
  const unrestricted = vi.spyOn(io, 'readUtf8');
  const bounded = vi.spyOn(io, 'readUtf8Bounded');
  await expect(fs.getBacklinks('Root.md')).rejects.toThrow(/Graph.*changed/);
  expect(unrestricted.mock.calls.some(([path]) => path === join(vault, 'Neighbor.md'))).toBe(false);
  expect(bounded.mock.calls).toContainEqual([join(vault, 'Neighbor.md'), MAX_NOTE_CONTENT_BYTES]);
});

test('context targets are deduplicated across authors and bounded to eight concurrent reads', async () => {
  const { vault, graph, fs } = await fixture();
  const names = Array.from({ length: 20 }, (_, i) => `Peer${i}`);
  for (const name of names) { await writeFile(join(vault, `${name}.md`), `# ${name}`); graph.invalidate(`${name}.md`); }
  const body = names.map(name => `[[Root]] [[${name}]] [[${name}]]`).join('\n');
  for (const name of ['Author.md', 'Second.md']) { await writeFile(join(vault, name), body); graph.invalidate(name); }
  const read = fs.readNoteRevision.bind(fs);
  let active = 0, peak = 0;
  const checked: string[] = [];
  vi.spyOn(fs, 'readNoteRevision').mockImplementation(async (path, maxBytes) => {
    if (!path.startsWith('Peer')) return read(path, maxBytes);
    checked.push(path); active++; peak = Math.max(peak, active);
    try { return await read(path, maxBytes); } finally { active--; }
  });
  expect(await fs.getBacklinks('Root.md', 1)).toMatchObject({ total: 40, truncated: true });
  expect(checked).toHaveLength(20);
  expect(new Set(checked).size).toBe(20);
  expect(peak).toBeGreaterThan(1);
  expect(peak).toBeLessThanOrEqual(8);
});

test('permission changes during context validation reject the captured view', async () => {
  const { fs } = await fixture();
  const read = fs.readNoteRevision.bind(fs);
  let allowed = true;
  vi.spyOn(fs, 'readNoteRevision').mockImplementation(async (path, maxBytes) => {
    const revision = await read(path, maxBytes);
    if (path === 'Neighbor.md') allowed = false;
    return revision;
  });
  await expect(fs.getBacklinks('Root.md', 10, path => path !== 'Neighbor.md' || allowed)).rejects.toThrow(/Graph.*changed/);
});

test('observed context drift during final root validation rejects the captured view', async () => {
  const { vault, graph, fs } = await fixture();
  const read = fs.readNoteRevision.bind(fs);
  vi.spyOn(fs, 'readNoteRevision').mockImplementation(async (path, maxBytes) => {
    const revision = await read(path, maxBytes);
    if (path === 'Root.md') { await writeFile(join(vault, 'Neighbor.md'), '# Changed'); graph.invalidate('Neighbor.md'); }
    return revision;
  });
  await expect(fs.getBacklinks('Root.md')).rejects.toThrow(/Graph.*changed/);
});

test('failed context checks drain sibling reads before the query rejects', async () => {
  const { vault, graph, fs } = await fixture();
  await writeFile(join(vault, 'Author.md'), '[[Root]] [[Neighbor]] [[Unrelated]]');
  graph.invalidate('Author.md');
  const read = fs.readNoteRevision.bind(fs);
  let entered!: () => void, release!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  vi.spyOn(fs, 'readNoteRevision').mockImplementation(async (path, maxBytes) => {
    if (path === 'Neighbor.md') { await started; throw new Error('fixture failure'); }
    if (path === 'Unrelated.md') { entered(); await gate; }
    return read(path, maxBytes);
  });
  let settled = false;
  const result = fs.getBacklinks('Root.md').then(value => { settled = true; return value; }, error => { settled = true; return error; });
  await started;
  try { await new Promise<void>(resolve => setImmediate(resolve)); expect(settled).toBe(false); }
  finally { release(); expect(await result).toBeInstanceOf(Error); }
});
