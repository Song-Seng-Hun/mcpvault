import { guidanceError } from './guidance-runtime.js';
import { open } from 'node:fs/promises';
import { createGunzip } from 'node:zlib';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
const READ_CHUNK_BYTES = 64 * 1024;
async function* storedChunks(handle, maxBytes) {
    let total = 0;
    // Stat is only an early rejection. Count actual bytes and probe at most one
    // extra byte so concurrent file growth cannot bypass the stored ceiling.
    for (;;) {
        const chunk = Buffer.allocUnsafe(Math.min(READ_CHUNK_BYTES, maxBytes - total + 1));
        const { bytesRead } = await handle.read(chunk, 0, chunk.length, null);
        if (bytesRead === 0)
            return;
        total += bytesRead;
        if (total > maxBytes)
            throw guidanceError(new Error('Snapshot size exceeded'), 'guid-6e3e9727eeb0d592');
        yield chunk.subarray(0, bytesRead);
    }
}
async function collectBytes(source, maxBytes) {
    const chunks = [];
    let total = 0;
    for await (const chunk of source) {
        total += chunk.length;
        if (total > maxBytes)
            throw guidanceError(new Error('Snapshot size exceeded'), 'guid-6e3e9727eeb0d592');
        chunks.push(chunk);
    }
    // Callers require complete bytes. This still holds decoded chunks plus the
    // final buffer; it does not assemble or retain a whole compressed payload.
    return Buffer.concat(chunks, total);
}
/** Bounded optional cache IO, not a source-document reader or a global RAM cap. */
export async function readSnapshotBytes(path, limits) {
    const ceilings = limits.maxDecodedBytes === undefined ? [limits.maxBytes] : [limits.maxBytes, limits.maxDecodedBytes];
    for (const value of ceilings) {
        if (!Number.isSafeInteger(value) || value < 1 || value > 0x7fffffff) {
            throw guidanceError(new TypeError('Invalid snapshot byte limit'), 'guid-0d65cfcdd8523b6d');
        }
    }
    try {
        const handle = await open(path, 'r');
        try {
            const info = await handle.stat();
            if (!info.isFile() || info.size > limits.maxBytes)
                throw guidanceError(new Error('Invalid snapshot file'), 'guid-7d9ea82c9d983e04');
            const source = storedChunks(handle, limits.maxBytes);
            if (limits.maxDecodedBytes === undefined)
                return await collectBytes(source, limits.maxBytes);
            const decodedLimit = limits.maxDecodedBytes;
            return await pipeline(Readable.from(source, { objectMode: false, highWaterMark: READ_CHUNK_BYTES }), createGunzip(), decoded => collectBytes(decoded, decodedLimit));
        }
        finally {
            await handle.close();
        }
    }
    catch {
        // Cache callers already rebuild from Markdown; never expose host paths or
        // native decoder messages when reporting an optional snapshot failure.
        throw guidanceError(new Error('Snapshot unavailable'), 'guid-990719536f77992d');
    }
}
