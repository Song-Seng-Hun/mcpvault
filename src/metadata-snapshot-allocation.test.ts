import { afterEach, expect, test, vi } from 'vitest';
import { mkdtemp, realpath, rm, writeFile, readFile } from 'node:fs/promises';
import { basename, isAbsolute, join, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { VaultMetadataIndex } from './vault-index.js';
import { FrontmatterHandler } from './frontmatter.js';
import { PathFilter } from './pathfilter.js';
import { encodeMetadataSnapshot, decodeMetadataSnapshot, METADATA_SNAPSHOT_MAX_BYTES,
  METADATA_SNAPSHOT_MAX_ENTRIES, type MetadataSnapshotEntry } from './metadata-snapshot.js';

afterEach(() => vi.restoreAllMocks());

const entry = (frontmatter: Record<string, any> = { title: '한글🙂' }): MetadataSnapshotEntry => ({
  path: 'Note.md', revision: 'abc', frontmatter, size: 123, mtimeMs: 456.25,
});

// Former v1 encoder, only used with small synthetic fixtures as a byte oracle.
function legacyEncode(entries: MetadataSnapshotEntry[]): Buffer {
  const chunks = [Buffer.from('MCPVMETA', 'ascii')], header = Buffer.allocUnsafe(8);
  header.writeUInt32LE(1, 0); header.writeUInt32LE(entries.length, 4); chunks.push(header);
  const string = (value: string) => {
    const bytes = Buffer.from(value, 'utf8'), length = Buffer.allocUnsafe(4);
    length.writeUInt32LE(bytes.length, 0); return Buffer.concat([length, bytes]);
  };
  for (const row of entries) {
    chunks.push(string(row.path), string(row.revision), string(JSON.stringify(row.frontmatter)));
    const numbers = Buffer.allocUnsafe(16);
    numbers.writeDoubleLE(row.size, 0); numbers.writeDoubleLE(row.mtimeMs, 8); chunks.push(numbers);
  }
  return Buffer.concat(chunks);
}

function rejectsBeforeAllocation(run: () => unknown, message?: string) {
  const allocate = vi.spyOn(Buffer, 'allocUnsafe');
  try { expect(run).toThrow(message); expect(allocate).not.toHaveBeenCalled(); }
  finally { allocate.mockRestore(); }
}

test('empty, Unicode and numeric fields remain byte-identical to v1', () => {
  const rows = [entry(), { ...entry({ list: [1, true, null], escaped: '\ud800', nested: { title: '한글' } }),
    path: '폴더/🙂\ud800.MARKDOWN', revision: '', size: -0, mtimeMs: Number.MAX_SAFE_INTEGER }];
  for (const fixture of [[], rows.slice(0, 1), rows]) {
    const expected = legacyEncode(fixture), actual = encodeMetadataSnapshot(fixture);
    expect(actual.length).toBe(expected.length); expect(actual.equals(expected)).toBe(true);
    expect(decodeMetadataSnapshot(actual)).toEqual(decodeMetadataSnapshot(expected));
  }
  expect(decodeMetadataSnapshot(encodeMetadataSnapshot(rows))![1]!.path).toBe('폴더/🙂\ufffd.MARKDOWN');
  expect(Object.is(decodeMetadataSnapshot(encodeMetadataSnapshot(rows))![1]!.size, -0)).toBe(true);
});

test('allocates only one exact output buffer without UTF-8 field copies', () => {
  const rows = Array.from({ length: 128 }, (_, i) => ({ ...entry(), path: `노트-${i}.md` }));
  const expected = legacyEncode(rows), allocate = vi.spyOn(Buffer, 'allocUnsafe');
  const from = vi.spyOn(Buffer, 'from'), concat = vi.spyOn(Buffer, 'concat');
  const actual = encodeMetadataSnapshot(rows);
  expect(allocate).toHaveBeenCalledExactlyOnceWith(expected.length);
  expect(from).not.toHaveBeenCalled(); expect(concat).not.toHaveBeenCalled();
  expect(actual.equals(expected)).toBe(true);
});

test('accepts exact byte/count caps, rejects overflow before output allocation', () => {
  expect(encodeMetadataSnapshot([], { maxBytes: 16, maxEntries: 0 }).length).toBe(16);
  const rows = [entry()], bytes = legacyEncode(rows).length;
  expect(encodeMetadataSnapshot(rows, { maxBytes: bytes, maxEntries: 1 }).length).toBe(bytes);
  rejectsBeforeAllocation(() => encodeMetadataSnapshot(rows, { maxBytes: bytes - 1 }), 'size exceeded');
  rejectsBeforeAllocation(() => encodeMetadataSnapshot([entry({ text: 'x'.repeat(1024) })], { maxBytes: 128 }), 'size exceeded');
  const serialize = vi.fn(() => ({}));
  rejectsBeforeAllocation(() => encodeMetadataSnapshot([entry({ toJSON: serialize })], { maxEntries: 0 }), 'entry limit');
  expect(serialize).not.toHaveBeenCalled();
  const tooMany = new Array<MetadataSnapshotEntry>(METADATA_SNAPSHOT_MAX_ENTRIES + 1);
  rejectsBeforeAllocation(() => encodeMetadataSnapshot(tooMany), 'entry limit');
});

test.each([
  { maxBytes: NaN }, { maxBytes: Infinity }, { maxBytes: 15 }, { maxBytes: 16.5 },
  { maxBytes: METADATA_SNAPSHOT_MAX_BYTES + 1 }, { maxEntries: -1 }, { maxEntries: NaN },
  { maxEntries: Infinity }, { maxEntries: 0.5 }, { maxEntries: METADATA_SNAPSHOT_MAX_ENTRIES + 1 },
])('limits can only narrow production ceilings: %j', limits => {
  rejectsBeforeAllocation(() => encodeMetadataSnapshot([], limits), 'Invalid metadata snapshot limit');
});

test('undefined, BigInt and cyclic Properties fail before output allocation', () => {
  const cycle: Record<string, any> = {}; cycle.self = cycle;
  for (const frontmatter of [undefined, { value: 1n }, cycle]) {
    rejectsBeforeAllocation(() => encodeMetadataSnapshot([{ ...entry(), frontmatter: frontmatter as any }]));
  }
});

test('captures each field and serialization exactly once', () => {
  const getters = { path: vi.fn(() => 'Note.md'), revision: vi.fn(() => 'abc'), size: vi.fn(() => 123),
    mtimeMs: vi.fn(() => 456.25), frontmatter: vi.fn(() => ({ toJSON: serialize })) };
  const serialize = vi.fn(() => ({ title: 'captured' }));
  const row = Object.defineProperties({}, Object.fromEntries(Object.entries(getters).map(([key, get]) => [key, { get }])));
  const encoded = encodeMetadataSnapshot([row as MetadataSnapshotEntry]);
  for (const get of Object.values(getters)) expect(get).toHaveBeenCalledTimes(1);
  expect(serialize).toHaveBeenCalledTimes(1);
  expect(decodeMetadataSnapshot(encoded)).toEqual([entry({ title: 'captured' })]);
});

test('decoder rejects truncated, trailing, malformed and nonfinite snapshots', () => {
  const valid = encodeMetadataSnapshot([entry()]);
  for (let end = 0; end < valid.length; end++) expect(decodeMetadataSnapshot(valid.subarray(0, end))).toBeUndefined();
  const version = Buffer.from(valid); version.writeUInt32LE(2, 8);
  const count = Buffer.from(valid); count.writeUInt32LE(METADATA_SNAPSHOT_MAX_ENTRIES + 1, 12);
  const length = Buffer.from(valid); length.writeUInt32LE(0xffffffff, 16);
  const magic = Buffer.from(valid); magic[0] = 0;
  for (const bytes of [version, count, length, magic, Buffer.concat([valid, Buffer.from([0])]),
    encodeMetadataSnapshot([{ ...entry(), path: 'Note.exe' }]),
    encodeMetadataSnapshot([{ ...entry(), size: NaN }]),
    encodeMetadataSnapshot([{ ...entry(), frontmatter: [] as any }])]) {
    expect(decodeMetadataSnapshot(bytes)).toBeUndefined();
  }
});

async function fixture(run: (root: string, index: VaultMetadataIndex) => Promise<void>) {
  const base = await realpath(tmpdir()), prefix = 'mcpvault-metadata-encoding-', root = await mkdtemp(join(base, prefix));
  await writeFile(join(root, 'Note.md'), '---\ntitle: 한글\n---\nBody');
  const index = new VaultMetadataIndex(root, new PathFilter(), new FrontmatterHandler());
  vi.spyOn(index as any, 'startWatcher').mockImplementation(() => undefined);
  try { await index.list(); await run(root, index); }
  finally {
    await index.close(); vi.restoreAllMocks();
    const target = await realpath(root), rel = relative(base, target);
    if (!rel || rel.startsWith('..') || isAbsolute(rel) || !basename(target).startsWith(prefix)) throw new Error('Unsafe cleanup');
    await rm(target, { recursive: true, force: true });
  }
}

test('metadata save avoids per-field buffers and concatenation copies', async () => {
  await fixture(async (root, index) => {
    const concat = vi.spyOn(Buffer, 'concat'), from = vi.spyOn(Buffer, 'from');
    await (index as any).flushSnapshot();
    const concatCount = concat.mock.calls.length;
    const fieldCopies = from.mock.calls.filter(([value]) => typeof value === 'string' && value.includes('한글')).length;
    vi.restoreAllMocks();
    expect((await readFile(join(root, '.mcpvault/metadata-index.snapshot.bin'))).subarray(0, 8).toString()).toBe('MCPVMETA');
    expect(concatCount).toBe(0); expect(fieldCopies).toBe(0);
  });
});

test('failed encoding preserves previous snapshot and Markdown; a later edit saves normally', async () => {
  await fixture(async (root, index) => {
    const snapshot = join(root, '.mcpvault/metadata-index.snapshot.bin'), note = join(root, 'Note.md');
    await (index as any).flushSnapshot();
    const before = await readFile(snapshot), source = await readFile(note, 'utf8');
    // Inject a nonserializable derived value, never into authoritative Markdown.
    const row = (await index.list())[0]!;
    row.frontmatter.bad = 1n; (index as any).snapshotPending = true;
    await (index as any).flushSnapshot();
    expect((await readFile(snapshot)).equals(before)).toBe(true);
    expect(await readFile(note, 'utf8')).toBe(source);
    expect((await index.list())[0]!.revision).toBe(row.revision);
    await writeFile(note, source.replace('한글', '수정된 제목'));
    index.invalidate('Note.md', 'upsert'); const current = await index.list();
    expect(current[0]!.frontmatter).toEqual({ title: '수정된 제목' });
    await (index as any).flushSnapshot();
    expect(decodeMetadataSnapshot(await readFile(snapshot))).toEqual(current);
  });
});
