import { open } from 'node:fs/promises';
import { gunzip } from 'node:zlib';
import { promisify } from 'node:util';

const gunzipAsync = promisify(gunzip);
const READ_CHUNK_BYTES = 64 * 1024;

interface SnapshotReadLimits {
  maxBytes: number;
  /** When present, the file is gzip and this caps decoded bytes before parsing. */
  maxDecodedBytes?: number;
}

/** Bounded optional cache IO, not a source-document reader or a global RAM cap. */
export async function readSnapshotBytes(path: string, limits: SnapshotReadLimits): Promise<Buffer> {
  for (const value of [limits.maxBytes, limits.maxDecodedBytes]) {
    if (value !== undefined && (!Number.isSafeInteger(value) || value < 1 || value > 0x7fffffff)) {
      throw new TypeError('Invalid snapshot byte limit');
    }
  }
  try {
    const handle = await open(path, 'r');
    let stored: Buffer;
    try {
      const info = await handle.stat();
      if (!info.isFile() || info.size > limits.maxBytes) throw new Error('Invalid snapshot file');
      const chunks: Buffer[] = [];
      let total = 0;
      // Do not trust stat alone: the opened file can grow while it is read.
      // One extra byte detects overflow without ever reading an unbounded file.
      for (;;) {
        const chunk = Buffer.allocUnsafe(Math.min(READ_CHUNK_BYTES, limits.maxBytes - total + 1));
        const { bytesRead } = await handle.read(chunk, 0, chunk.length, null);
        if (bytesRead === 0) break;
        total += bytesRead;
        if (total > limits.maxBytes) throw new Error('Snapshot size exceeded');
        chunks.push(chunk.subarray(0, bytesRead));
      }
      stored = Buffer.concat(chunks, total);
    } finally {
      await handle.close();
    }
    return limits.maxDecodedBytes === undefined
      ? stored
      : await gunzipAsync(stored, { maxOutputLength: limits.maxDecodedBytes });
  } catch {
    // Cache callers already rebuild from Markdown; never expose host paths or
    // native decoder messages when reporting an optional snapshot failure.
    throw new Error('Snapshot unavailable');
  }
}
