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
    graph.close();
    await rm(vault, { recursive: true, force: true });
  }
});
async function fixture(hidden = false) {
  const vault = await mkdtemp(join(tmpdir(), 'mcpvault-outlink-target-'));
  await writeFile(join(vault, 'Root.md'), '# Links\n[[Target]]\n[[Alias]]\n[[Other]]');
  await writeFile(join(vault, 'Target.md'), `---\naliases: [Alias]\nmoderation_status: ${hidden ? 'hidden' : 'active'}\n---\n# Target`);
  await writeFile(join(vault, 'Other.md'), '# Other');
  const graph = new VaultGraphIndex(vault, new PathFilter(), new FrontmatterHandler());
  fixtures.push({ vault, graph });
  vi.spyOn(graph as any, 'startWatcher').mockImplementation(() => {});
  const io = new VaultIoCoordinator();
  const fs = new FileSystemService(vault, undefined, undefined, undefined, undefined, graph, io);
  await fs.getOutlinks('Root.md');
  return { vault, graph, fs, io };
}

test.each([false, true])('outlinks reject a newly hidden target even off the requested page (revision=%s)', async includeSourceRevision => {
  const { vault, fs } = await fixture();
  await writeFile(join(vault, 'Target.md'), '---\naliases: [Alias]\nmoderation_status: hidden\n---\n# Target');
  await expect(fs.getOutlinks('Root.md', 1, () => true, 2, { includeSourceRevision })).rejects.toThrow(/Graph.*changed/);
  const fresh = await fs.getOutlinks('Root.md');
  expect(fresh.total).toBe(1);
  expect(fresh.outlinks[0]!.target).toBe('Other');
  expect(JSON.stringify(fresh)).not.toContain('Target');
  expect(JSON.stringify(fresh)).not.toContain('Alias');
});

test('outlinks refresh newly unhidden targets instead of keeping a stale exclusion', async () => {
  const { vault, fs } = await fixture(true);
  await writeFile(join(vault, 'Target.md'), '---\naliases: [Alias]\n---\n# Target');
  await expect(fs.getOutlinks('Root.md')).rejects.toThrow(/Graph.*changed/);
  expect((await fs.getOutlinks('Root.md')).total).toBe(3);
});

test('outlinks reject outdated alias metadata even with an unchanged source body', async () => {
  const { vault, fs } = await fixture();
  await writeFile(join(vault, 'Target.md'), '---\naliases: [Replacement]\n---\n# Target');
  await expect(fs.getOutlinks('Root.md')).rejects.toThrow(/Graph.*changed/);
  expect((await fs.getOutlinks('Root.md')).total).toBe(3);
});

test('outlinks reject a removed known target then expose its authored unresolved link on retry', async () => {
  const { vault, fs } = await fixture();
  await rm(join(vault, 'Target.md'));
  await expect(fs.getOutlinks('Root.md')).rejects.toThrow(/Graph.*changed/);
  expect((await fs.getOutlinks('Root.md')).outlinks.map(row => row.target)).toContain('Target');
});

test('target verification never reads scope-denied candidates', async () => {
  const { fs } = await fixture();
  const reads = vi.spyOn(fs, 'readNoteRevision');
  const result = await fs.getOutlinks('Root.md', 10, path => path !== 'Target.md');
  expect(result.total).toBe(1);
  expect(reads.mock.calls.some(([path]) => path === 'Target.md')).toBe(false);
});

test('repeated and alias references hash each target once without scanning unrelated bodies', async () => {
  const { vault, graph, fs } = await fixture();
  await writeFile(join(vault, 'Root.md'), '[[Root]] [[Target]] [[Alias]] [[Target]] [[Other]]');
  await writeFile(join(vault, 'Unrelated.md'), '# Unrelated');
  graph.invalidate('Root.md'); graph.invalidate('Unrelated.md');
  const reads = vi.spyOn(fs, 'readNoteRevision');
  expect((await fs.getOutlinks('Root.md')).total).toBe(5);
  expect(reads.mock.calls.map(([path]) => path).sort()).toEqual(['Other.md', 'Root.md', 'Target.md']);
});

test('target checks are batched at eight and cover off-page targets', async () => {
  const { vault, graph, fs } = await fixture();
  const names = Array.from({ length: 20 }, (_, index) => `Note${index}`);
  for (const name of names) {
    await writeFile(join(vault, `${name}.md`), `# ${name}`);
    graph.invalidate(`${name}.md`);
  }
  await writeFile(join(vault, 'Root.md'), names.map(name => `[[${name}]]`).join('\n'));
  graph.invalidate('Root.md');
  const read = fs.readNoteRevision.bind(fs);
  let active = 0, peak = 0;
  const checked: string[] = [];
  vi.spyOn(fs, 'readNoteRevision').mockImplementation(async (path, maxBytes) => {
    if (path === 'Root.md') return read(path, maxBytes);
    checked.push(path); active++; peak = Math.max(peak, active);
    try { return await read(path, maxBytes); } finally { active--; }
  });
  expect(await fs.getOutlinks('Root.md', 1)).toMatchObject({ total: 20, truncated: true });
  expect(checked).toHaveLength(20);
  expect(peak).toBeLessThanOrEqual(8);
  expect(peak).toBeGreaterThan(1);
});

test('a permission change during target hashing rejects the captured projection', async () => {
  const { fs } = await fixture();
  let allowed = true;
  const read = fs.readNoteRevision.bind(fs);
  vi.spyOn(fs, 'readNoteRevision').mockImplementation(async (path, maxBytes) => {
    const revision = await read(path, maxBytes);
    if (path === 'Target.md') allowed = false;
    return revision;
  });
  await expect(fs.getOutlinks('Root.md', 10, path => path !== 'Target.md' || allowed)).rejects.toThrow(/Graph.*changed/);
});

test('an observed target edit during root hashing is rejected by the outer barrier', async () => {
  const { vault, graph, fs } = await fixture();
  const read = fs.readNoteRevision.bind(fs);
  vi.spyOn(fs, 'readNoteRevision').mockImplementation(async (path, maxBytes) => {
    const revision = await read(path, maxBytes);
    if (path === 'Root.md') {
      await writeFile(join(vault, 'Target.md'), '# Changed');
      graph.invalidate('Target.md');
    }
    return revision;
  });
  await expect(fs.getOutlinks('Root.md')).rejects.toThrow(/Graph.*changed/);
});

test('failed target checks drain siblings before returning the retry error', async () => {
  const { fs } = await fixture();
  const read = fs.readNoteRevision.bind(fs);
  let entered!: () => void, release!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  vi.spyOn(fs, 'readNoteRevision').mockImplementation(async (path, maxBytes) => {
    if (path === 'Target.md') { await started; throw new Error('fixture failure'); }
    if (path === 'Other.md') { entered(); await gate; }
    return read(path, maxBytes);
  });
  let settled = false;
  const result = fs.getOutlinks('Root.md').then(value => { settled = true; return value; }, error => { settled = true; return error; });
  await started;
  try {
    await new Promise<void>(resolve => setImmediate(resolve));
    expect(settled).toBe(false);
  } finally {
    release();
    expect(await result).toBeInstanceOf(Error);
  }
});

test('visible alias fallback targets are verified when a scope-denied exact name shadows them', async () => {
  const { vault, graph, fs } = await fixture();
  await writeFile(join(vault, 'Actual.md'), '---\naliases: [Target]\n---\n# Actual');
  graph.invalidate('Actual.md');
  const canAccess = (path: string) => path !== 'Target.md';
  expect((await fs.getOutlinks('Root.md', 10, canAccess)).outlinks.map(link => link.target)).toContain('Target');
  await writeFile(join(vault, 'Actual.md'), '---\naliases: [Target]\nmoderation_status: hidden\n---\n# Actual');
  await expect(fs.getOutlinks('Root.md', 10, canAccess)).rejects.toThrow(/Graph.*changed/);
  expect((await fs.getOutlinks('Root.md', 10, canAccess)).outlinks.map(link => link.target)).not.toContain('Target');
});

test('a cached target that grows oversized is rejected without an unrestricted body read', async () => {
  const { vault, fs, io } = await fixture();
  await truncate(join(vault, 'Target.md'), MAX_NOTE_CONTENT_BYTES + 1);
  const unrestricted = vi.spyOn(io, 'readUtf8');
  const bounded = vi.spyOn(io, 'readUtf8Revision');
  await expect(fs.getOutlinks('Root.md')).rejects.toThrow(/Graph.*changed/);
  expect(unrestricted.mock.calls.some(([path]) => path === join(vault, 'Target.md'))).toBe(false);
  expect(bounded.mock.calls).toContainEqual([join(vault, 'Target.md'), MAX_NOTE_CONTENT_BYTES]);
});

test('an existing hidden alias fallback can recover after unhide despite a denied exact name', async () => {
  const { vault, graph, fs } = await fixture();
  await writeFile(join(vault, 'Actual.md'), '---\naliases: [Target]\nmoderation_status: hidden\n---\n# Actual');
  graph.invalidate('Actual.md');
  const canAccess = (path: string) => path !== 'Target.md';
  expect((await fs.getOutlinks('Root.md', 10, canAccess)).outlinks.map(link => link.target)).not.toContain('Target');
  await writeFile(join(vault, 'Actual.md'), '---\naliases: [Target]\n---\n# Actual');
  await expect(fs.getOutlinks('Root.md', 10, canAccess)).rejects.toThrow(/Graph.*changed/);
  expect((await fs.getOutlinks('Root.md', 10, canAccess)).outlinks.map(link => link.target)).toContain('Target');
});
