const CHUNK_BYTES = 64 * 1024;

/** Owned, bounded output buffers; accepted string records still encode individually. */
export function* snapshotByteChunks(chunks: Iterable<string | Uint8Array>, maxBytes: number): Generator<Buffer, void, unknown> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0 || maxBytes > 0x7fffffff) throw new TypeError('Invalid snapshot byte limit');
  let total = 0, used = 0;
  let output: Buffer | undefined;
  for (const chunk of chunks) {
    const size = typeof chunk === 'string' ? Buffer.byteLength(chunk) : chunk.byteLength;
    total += size;
    if (total > maxBytes) throw new Error('Snapshot size exceeded');
    const bytes = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
    for (let offset = 0; offset < size;) {
      output ??= Buffer.allocUnsafe(CHUNK_BYTES);
      const length = Math.min(CHUNK_BYTES - used, size - offset);
      output.set(bytes.subarray(offset, offset + length), used);
      used += length;
      offset += length;
      if (used === CHUNK_BYTES) {
        const complete = output;
        output = undefined;
        used = 0;
        yield complete;
      }
    }
  }
  if (output && used) yield output.subarray(0, used);
}
