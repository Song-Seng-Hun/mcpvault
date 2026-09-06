import { afterEach, expect, test, vi } from 'vitest';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { FileSystemService, MAX_NOTE_CONTENT_BYTES } from './filesystem.js';

const observed = vi.hoisted(() => ({ active: false, full: [] as string[], bounded: [] as Array<{ path: string; cap: number }> }));
vi.mock('node:fs/promises', async importOriginal => {
  const real = await importOriginal<typeof import('node:fs/promises')>();
  return { ...real, readFile: (...args: Parameters<typeof real.readFile>) => {
    if (observed.active) observed.full.push(String(args[0]));
    return real.readFile(...args);
  } };
});
vi.mock('./bounded-source-read.js', async importOriginal => {
  const real = await importOriginal<typeof import('./bounded-source-read.js')>();
  return { ...real, readBoundedSource: (path: string, cap: number) => {
    if (observed.active) observed.bounded.push({ path, cap });
    return real.readBoundedSource(path, cap);
  } };
});
const vaults: string[] = [];
afterEach(async () => {
  observed.active = false; observed.full = []; observed.bounded = []; vi.restoreAllMocks();
  for (const vault of vaults.splice(0)) await rm(vault, { recursive: true, force: true });
});
const hash = (raw: string) => createHash('sha256').update(raw).digest('hex');
async function fixture() {
  const vault = await mkdtemp(join(tmpdir(), 'mcpvault-change-budget-')); vaults.push(vault);
  const notices: string[] = [];
  const fs = new FileSystemService(vault, undefined, undefined, path => { notices.push(path); });
  const changes = await Promise.all(['A.md', 'B.md'].map(async path => {
    await writeFile(join(vault, path), '# Original\n');
    return { path, expectedRevision: hash('# Original\n'), patches: [{ oldString: 'Original', newString: 'Updated' }] };
  }));
  const preview = await fs.patchMultipleNotes({ changes });
  return { vault, fs, changes, notices, apply: { changes, dryRun: false, confirmPlanFingerprint: preview.planFingerprint } };
}
function expectBoundedOnly() {
  expect(observed.full).toEqual([]);
  expect(observed.bounded.length).toBeGreaterThan(0);
  for (const read of observed.bounded) expect(read.cap).toBe(MAX_NOTE_CONTENT_BYTES);
}

test('change-set preflight rejects an oversized original even when its resulting note would fit', async () => {
  const { vault, fs, notices } = await fixture();
  const raw = `---\npayload: ${'x'.repeat(MAX_NOTE_CONTENT_BYTES)}\n---\n# Keep\n`;
  await writeFile(join(vault, 'A.md'), raw);
  observed.active = true;
  const result = await fs.patchMultipleNotes({ changes: [{ path: 'A.md', expectedRevision: hash(raw), frontmatter: { remove: ['payload'] } }] }).catch(error => error);
  observed.active = false;
  expect(result).toBeInstanceOf(Error);
  expect(String(result)).toMatch(/read budget/);
  expect(await readFile(join(vault, 'A.md'), 'utf8')).toBe(raw);
  expect(notices).toEqual([]);
  expectBoundedOnly();
});

test('successful multi-note edits bound preflight, whole-batch and individual rechecks', async () => {
  const { vault, fs, apply } = await fixture();
  observed.active = true;
  const result = await fs.patchMultipleNotes(apply);
  observed.active = false;
  expect(result.applied).toBe(true);
  for (const item of result.changes) {
    const raw = await readFile(join(vault, item.path), 'utf8');
    expect(raw).toBe('# Updated\n'); expect(item.revision).toBe(hash(raw));
  }
  expectBoundedOnly();
  expect(observed.bounded).toHaveLength(6);
});

test('rollback bounds reads of externally grown content and preserves it', async () => {
  const { vault, fs, apply, notices } = await fixture();
  const service = fs as any, resolve = service.resolveWritablePath.bind(fs);
  const external = 'y'.repeat(MAX_NOTE_CONTENT_BYTES + 1);
  let injected = false;
  vi.spyOn(service, 'resolveWritablePath').mockImplementation((path: unknown) => {
    if (path === 'B.md' && !injected) {
      injected = true; writeFileSync(join(vault, 'A.md'), external);
      throw new Error('destination unavailable');
    }
    return resolve(path);
  });
  observed.active = true;
  await expect(fs.patchMultipleNotes(apply)).rejects.toThrow(/Rollback was incomplete/);
  observed.active = false;
  expect(await readFile(join(vault, 'A.md'), 'utf8')).toBe(external);
  expect(await readFile(join(vault, 'B.md'), 'utf8')).toBe('# Original\n');
  expect(notices).toContain('A.md');
  expectBoundedOnly();
  expect(observed.bounded.filter(read => read.path === join(vault, 'A.md'))).toHaveLength(4);
});

test('growth after preflight is bounded and rejected before the first write', async () => {
  const { vault, fs, apply, notices } = await fixture();
  const read = fs.readNote.bind(fs), external = 'z'.repeat(MAX_NOTE_CONTENT_BYTES + 1);
  vi.spyOn(fs, 'readNote').mockImplementation(async (path, cap) => {
    const note = await read(path, cap);
    if (path === 'B.md') await writeFile(join(vault, path), external);
    return note;
  });
  observed.active = true;
  await expect(fs.patchMultipleNotes(apply)).rejects.toThrow(/read budget/);
  observed.active = false;
  expect(await readFile(join(vault, 'A.md'), 'utf8')).toBe('# Original\n');
  expect(await readFile(join(vault, 'B.md'), 'utf8')).toBe(external);
  expect(notices).toEqual([]);
  expectBoundedOnly(); expect(observed.bounded).toHaveLength(4);
});

test('growth before the second individual write preserves it and restores our first write', async () => {
  const { vault, fs, apply, notices } = await fixture();
  const service = fs as any, resolve = service.resolveWritablePath.bind(fs);
  const external = 'q'.repeat(MAX_NOTE_CONTENT_BYTES + 1);
  let injected = false;
  vi.spyOn(service, 'resolveWritablePath').mockImplementation((path: unknown) => {
    if (path === 'B.md' && !injected) { injected = true; writeFileSync(join(vault, 'B.md'), external); }
    return resolve(path);
  });
  observed.active = true;
  await expect(fs.patchMultipleNotes(apply)).rejects.toThrow(/All attempted writes were restored/);
  observed.active = false;
  expect(await readFile(join(vault, 'A.md'), 'utf8')).toBe('# Original\n');
  expect(await readFile(join(vault, 'B.md'), 'utf8')).toBe(external);
  expect(notices).toEqual(expect.arrayContaining(['A.md', 'B.md']));
  expectBoundedOnly(); expect(observed.bounded).toHaveLength(7);
});

test('exactly 8 MiB of UTF-8 remains editable with a complete revision and bounded response', async () => {
  const { vault, fs } = await fixture();
  const available = MAX_NOTE_CONTENT_BYTES - 4;
  const raw = `Top\n${'가'.repeat(Math.floor(available / 3))}${'x'.repeat(available % 3)}`;
  expect(Buffer.byteLength(raw)).toBe(MAX_NOTE_CONTENT_BYTES);
  await writeFile(join(vault, 'A.md'), raw);
  const changes = [{ path: 'A.md', expectedRevision: hash(raw), patches: [{ oldString: 'Top', newString: 'New' }] }];
  observed.active = true;
  const preview = await fs.patchMultipleNotes({ changes, maxChars: 4096 });
  const result = await fs.patchMultipleNotes({ changes, maxChars: 4096, dryRun: false, confirmPlanFingerprint: preview.planFingerprint });
  observed.active = false;
  const expected = `New${raw.slice(3)}`;
  expect(await readFile(join(vault, 'A.md'), 'utf8')).toBe(expected);
  expect(result.changes[0]?.revision).toBe(hash(expected));
  expect(JSON.stringify(result).length).toBeLessThanOrEqual(4096);
  expectBoundedOnly();
});
