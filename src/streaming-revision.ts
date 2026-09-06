import { open } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { StringDecoder } from 'node:string_decoder';
import { SourceReadLimitError } from './bounded-source-read.js';

/** Preserve SHA256(decoded UTF-8), including replacement characters, without
 * retaining a whole file. Paths/permissions remain the service caller's job. */
export async function hashUtf8Source(path: string, maxBytes?: number): Promise<string> {
  if (maxBytes !== undefined && (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 0x7fffffff)) {
    throw new TypeError('Invalid source byte limit');
  }
  const handle = await open(path, 'r');
  try {
    const info = await handle.stat();
    if (!info.isFile()) throw new Error('Source is not a regular file');
    if (maxBytes !== undefined && info.size > maxBytes) throw new SourceReadLimitError();
    const buffer = Buffer.allocUnsafe(Math.min(64 * 1024, maxBytes === undefined ? Infinity : maxBytes + 1));
    const decoder = new StringDecoder('utf8'), hash = createHash('sha256');
    let size = 0;
    for (;;) {
      const length = maxBytes === undefined ? buffer.length : Math.min(buffer.length, maxBytes - size + 1);
      const { bytesRead } = await handle.read(buffer, 0, length, null);
      if (!bytesRead) return hash.update(decoder.end(), 'utf8').digest('hex');
      size += bytesRead;
      if (maxBytes !== undefined && size > maxBytes) throw new SourceReadLimitError();
      hash.update(decoder.write(buffer.subarray(0, bytesRead)), 'utf8');
    }
  } finally { await handle.close(); }
}
