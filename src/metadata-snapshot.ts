/** Unchanged v1 binary payload; snapshots are disposable restart acceleration. */
const MAGIC = Buffer.from('MCPVMETA', 'ascii');
const VERSION = 1;
export const METADATA_SNAPSHOT_MAX_ENTRIES = 1_000_000;
export const METADATA_SNAPSHOT_MAX_BYTES = 128 * 1024 * 1024;

export interface MetadataSnapshotEntry {
  path: string;
  frontmatter: Record<string, any>;
  revision: string;
  size: number;
  mtimeMs: number;
}

/** Serialize synchronously before IO so mutable index rows cannot change the
 * prepared snapshot. Limits may narrow, never broaden, production ceilings.
 * One giant JSON string still needs serialization; this is not a heap ceiling. */
export function encodeMetadataSnapshot(entries: readonly MetadataSnapshotEntry[], limits: { maxBytes?: number; maxEntries?: number } = {}): Buffer {
  const maxBytes = limits.maxBytes === undefined ? METADATA_SNAPSHOT_MAX_BYTES : limits.maxBytes;
  const maxEntries = limits.maxEntries === undefined ? METADATA_SNAPSHOT_MAX_ENTRIES : limits.maxEntries;
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 16 || maxBytes > METADATA_SNAPSHOT_MAX_BYTES
    || !Number.isSafeInteger(maxEntries) || maxEntries < 0 || maxEntries > METADATA_SNAPSHOT_MAX_ENTRIES) {
    throw new TypeError('Invalid metadata snapshot limit');
  }
  const count = entries.length;
  if (count > maxEntries) throw new Error('Metadata snapshot entry limit exceeded');
  const prepared: Array<{ path: string; revision: string; frontmatter: string; size: number; mtimeMs: number;
    lengths: [number, number, number] }> = [];
  let total = 16;
  for (const entry of entries) {
    const path = entry.path, revision = entry.revision;
    const frontmatter = JSON.stringify(entry.frontmatter);
    if (frontmatter === undefined) throw new Error('frontmatter is not serializable');
    const lengths: [number, number, number] = [Buffer.byteLength(path), Buffer.byteLength(revision), Buffer.byteLength(frontmatter)];
    total += 28 + lengths[0] + lengths[1] + lengths[2];
    if (total > maxBytes) throw new Error('Metadata snapshot size exceeded');
    prepared.push({ path, revision, frontmatter, size: entry.size, mtimeMs: entry.mtimeMs, lengths });
  }
  const output = Buffer.allocUnsafe(total);
  MAGIC.copy(output); output.writeUInt32LE(VERSION, 8); output.writeUInt32LE(count, 12);
  let offset = 16;
  const writeString = (value: string, length: number) => {
    output.writeUInt32LE(length, offset); offset += 4;
    output.write(value, offset, length, 'utf8'); offset += length;
  };
  for (const row of prepared) {
    writeString(row.path, row.lengths[0]); writeString(row.revision, row.lengths[1]); writeString(row.frontmatter, row.lengths[2]);
    output.writeDoubleLE(row.size, offset); output.writeDoubleLE(row.mtimeMs, offset + 8); offset += 16;
  }
  return output;
}

export function decodeMetadataSnapshot(buffer: Buffer): MetadataSnapshotEntry[] | undefined {
  if (buffer.length > METADATA_SNAPSHOT_MAX_BYTES || buffer.length < MAGIC.length + 8 || !buffer.subarray(0, MAGIC.length).equals(MAGIC)) return undefined;
  let offset = MAGIC.length;
  const version = buffer.readUInt32LE(offset);
  const count = buffer.readUInt32LE(offset + 4);
  offset += 8;
  if (version !== VERSION || count > METADATA_SNAPSHOT_MAX_ENTRIES) return undefined;
  const readString = (): string | undefined => {
    if (offset + 4 > buffer.length) return undefined;
    const length = buffer.readUInt32LE(offset);
    offset += 4;
    if (length > buffer.length - offset) return undefined;
    const value = buffer.toString('utf8', offset, offset + length);
    offset += length;
    return value;
  };
  const entries: MetadataSnapshotEntry[] = [];
  for (let index = 0; index < count; index += 1) {
    const path = readString();
    const revisionValue = readString();
    const frontmatterText = readString();
    if (path === undefined || revisionValue === undefined || frontmatterText === undefined || offset + 16 > buffer.length) return undefined;
    let frontmatter: unknown;
    try { frontmatter = JSON.parse(frontmatterText); } catch { return undefined; }
    if (!path || !/\.(?:md|markdown|txt)$/i.test(path) || !frontmatter || typeof frontmatter !== 'object' || Array.isArray(frontmatter)) return undefined;
    const size = buffer.readDoubleLE(offset);
    const mtimeMs = buffer.readDoubleLE(offset + 8);
    offset += 16;
    if (![size, mtimeMs].every(value => Number.isFinite(value))) return undefined;
    entries.push({ path, frontmatter: frontmatter as Record<string, any>, revision: revisionValue, size, mtimeMs });
  }
  return offset === buffer.length ? entries : undefined;
}
