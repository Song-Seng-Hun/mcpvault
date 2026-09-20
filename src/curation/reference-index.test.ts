import { afterEach, expect, test, vi } from 'vitest';
import { mkdtemp, mkdir, rm, rename, writeFile } from 'node:fs/promises';
import { tmpdir, userInfo } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { FileSystemService } from '../filesystem.js';
import { ReferenceImpactIndex } from './reference-index.js';
import { VaultFileCatalog } from '../vault-catalog.js';
import { PathFilter } from '../pathfilter.js';

const roots: string[] = [], indexes: ReferenceImpactIndex[] = [];
const budget = { maxFiles: 200, maxFileBytes: 256 * 1024, maxTotalBytes: 4 * 1024 * 1024 };
afterEach(async () => { vi.restoreAllMocks(); for (const i of indexes.splice(0)) await i.close(); for (const p of roots.splice(0)) await rm(p, { recursive: true, force: true }); });
async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'curation-reference-')); roots.push(root);
  const vault = join(root, 'vault'), host = join(root, 'private'); await mkdir(vault); await mkdir(host, { mode: 0o700 });
  if (process.platform === 'win32') await promisify(execFile)('icacls.exe', [host, '/inheritance:r', '/grant:r', `${userInfo().username}:(OI)(CI)F`], { windowsHide: true });
  let index: ReferenceImpactIndex;
  const fs = new FileSystemService(vault, undefined, undefined, (path, kind) => { void index?.invalidate([{ path, kind }]); },
    undefined, undefined, undefined, undefined, undefined, () => index);
  index = new ReferenceImpactIndex(fs, host); indexes.push(index);
  return { fs, index };
}

test('bounded deletion impact works beyond 200 unrelated notes without reading their bodies per request', async () => {
  const { fs, index } = await setup();
  await writeFile(join(fs.getVaultPath(), 'Target.md'), '---\naliases: [별명]\n---\nTarget');
  for (let i = 0; i < 220; i++) await writeFile(join(fs.getVaultPath(), `unrelated-${i}.md`), 'No reference');
  await writeFile(join(fs.getVaultPath(), 'History.txt'), '---\nmemory_basis:\n  - path: Target.md\n---\nHistory');
  await index.start();
  const read = vi.spyOn(fs, 'readNote'), enumerate = vi.spyOn(fs, 'referenceFiles');
  const impact = await fs.previewDeleteNote({ path: 'Target.md' }, () => true, budget);
  expect(impact.total).toBe(1); expect(impact.affectedProperties[0]?.sourcePath).toBe('History.txt');
  expect(enumerate).not.toHaveBeenCalled(); expect(read.mock.calls.length).toBeLessThanOrEqual(4);
  expect(() => fs.referencePreviewFence(structuredClone(impact))).toThrow();
  const fence = fs.referencePreviewFence(impact);
  void index.invalidate([{ path: 'History.txt', kind: 'upsert' }]); expect(fence).toThrow();
}, 30000);

test('indexed impact conservatively includes legacy Properties, aliases, relative links and snapshots', async () => {
  const { fs, index } = await setup();
  await writeFile(join(fs.getVaultPath(), 'Target.md'), '---\ntitle: Canonical\naliases: [별명, Another]\nstable_id: stable-id\n---\nTarget');
  const examples = [
    '[[별명#조건|display]]\n[link](Target.md)',
    '---\nproject: Target.md\nmemory_basis:\n  - path: Target.md\n    revision: abc\n---\nText',
    '---\ncustom:\n  instructions: "Read [[Another]]"\n---\n[[stable-id]]',
    '```md\n[[Target]]\n```\n[[./Target.md#anchor]]',
    '---\nreview_basis_links:\n  - path: scope://global/Target.md\n---\nHistory',
  ];
  for (let i = 0; i < examples.length; i++) await writeFile(join(fs.getVaultPath(), `Source${i}.md`), examples[i]!);
  await index.start();
  const legacy = await new FileSystemService(fs.getVaultPath()).previewDeleteNote({ path: 'Target.md' }, () => true, budget);
  const indexed = await fs.previewDeleteNote({ path: 'Target.md' }, () => true, budget);
  expect(indexed.affectedLinks).toEqual(legacy.affectedLinks); expect(indexed.affectedProperties).toEqual(legacy.affectedProperties);
  expect(indexed.total).toBeGreaterThan(5);
}, 30000);

test('a denied host-index scope prevents complete coverage rather than silently omitting it', async () => {
  const { fs } = await setup(); await writeFile(join(fs.getVaultPath(), 'Target.md'), 'Target');
  await writeFile(join(fs.getVaultPath(), 'Protected.md'), '[[Target]]');
  const host = join(roots.at(-1)!, 'private');
  const restricted = new ReferenceImpactIndex(fs, host, undefined, p => p !== 'Protected.md'); indexes.push(restricted);
  await restricted.start(); await expect(restricted.capture('Target.md', () => true)).rejects.toThrow('Reference integrity unavailable');
}, 30000);

test('shared raw watcher fences excluded guidance changes and watcher loss', async () => {
  const { fs } = await setup(); const host = join(roots.at(-1)!, 'private');
  await writeFile(join(fs.getVaultPath(), 'Target.md'), 'Target'); await writeFile(join(fs.getVaultPath(), 'Guidance.md'), 'No links');
  const catalog = new VaultFileCatalog(fs.getVaultPath(), new PathFilter(), p => p === 'Guidance.md');
  const index = new ReferenceImpactIndex(fs, host, catalog); indexes.push(index);
  try {
    await index.start(); const view = await index.capture('Target.md', () => true);
    await writeFile(join(fs.getVaultPath(), 'Guidance.md'), '[[Target]]');
    (catalog as any).onFilesystemEvent('Guidance.md', 'change');
    await expect(view.assertCurrent()).rejects.toThrow();
    await index.invalidate([{ path: 'Guidance.md', kind: 'upsert' }]);
    expect((await index.capture('Target.md', () => true)).candidates.map(c => c.path)).toContain('Guidance.md');
    catalog.close(); await expect(index.capture('Target.md', () => true)).rejects.toThrow();
  } finally { catalog.close(); }
}, 30000);

test('cold/incomplete captures never fall back to a foreground scan', async () => {
  const { fs, index } = await setup(); await writeFile(join(fs.getVaultPath(), 'Target.md'), 'Target');
  await expect(fs.previewDeleteNote({ path: 'Target.md' }, () => true, budget)).rejects.toThrow();
  await writeFile(join(fs.getVaultPath(), 'Overflow.md'), '[[other]]\n'.repeat(202)); await index.start();
  await expect(fs.previewDeleteNote({ path: 'Target.md' }, () => true, budget)).rejects.toThrow();
}, 30000);

test('hidden/fiction/draft candidates cannot turn into an empty integrity result or leak their identity', async () => {
  const { fs, index } = await setup(); await writeFile(join(fs.getVaultPath(), 'Target.md'), 'Target');
  await writeFile(join(fs.getVaultPath(), 'Secret.markdown'), '---\ncontent_domain: fiction\nstatus: draft\n---\n[[Target]]');
  await index.start();
  const error = await fs.previewDeleteNote({ path: 'Target.md' }, p => p !== 'Secret.markdown', budget).catch(e => e);
  expect(error).toBeInstanceOf(Error); expect(error.message).not.toContain('Secret');
}, 30000);

test('new references, access withdrawal, target edits and NAS loss invalidate captured results', async () => {
  const { fs, index } = await setup(); await writeFile(join(fs.getVaultPath(), 'Target.md'), 'Target'); await index.start();
  let allowed = true;
  const capture = await index.capture('Target.md', () => allowed); allowed = false;
  await expect(capture.assertCurrent()).rejects.toThrow(); allowed = true;
  const before = await index.capture('Target.md', () => true);
  await writeFile(join(fs.getVaultPath(), 'New.md'), '[[Target]]'); await index.invalidate([{ path: 'New.md', kind: 'upsert' }]);
  await expect(before.assertCurrent()).rejects.toThrow();
  const edited = await index.capture('Target.md', () => true); await writeFile(join(fs.getVaultPath(), 'Target.md'), 'Manual edit');
  await expect(edited.assertCurrent()).rejects.toThrow();
  const vault = fs.getVaultPath(); await rename(vault, vault + '-offline');
  try { await expect(index.capture('Target.md', () => true)).rejects.toThrow(); }
  finally { await rename(vault + '-offline', vault); }
}, 30000);
