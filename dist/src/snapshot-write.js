import { randomUUID } from 'node:crypto';
import { open, rename, unlink } from 'node:fs/promises';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGzip } from 'node:zlib';
import { setTimeout as delay } from 'node:timers/promises';
import { snapshotByteChunks } from './snapshot-chunks.js';
function byteLimit(maxBytes) {
    let total = 0;
    return new Transform({
        transform(chunk, _encoding, callback) {
            total += chunk.length;
            if (total > maxBytes)
                callback(new Error('Snapshot size exceeded'));
            else
                callback(null, chunk);
        },
    });
}
/** Internal disposable cache paths only. Does not authorize source-document IO. */
export async function writeGzipSnapshot(path, chunks, limits) {
    if (![limits.maxBytes, limits.maxDecodedBytes].every(value => Number.isSafeInteger(value) && value > 0 && value <= 0x7fffffff))
        throw new TypeError('Invalid snapshot byte limit');
    const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
    let owned = false;
    try {
        const handle = await open(temporary, 'wx', 0o600);
        owned = true;
        try {
            await pipeline(Readable.from(snapshotByteChunks(chunks, limits.maxDecodedBytes), { objectMode: false, highWaterMark: 64 * 1024 }), createGzip(), byteLimit(limits.maxBytes), handle.createWriteStream());
        }
        finally {
            await handle.close();
        }
        // Windows can briefly reject concurrent replacement even after streams
        // close. Bound retries; never unlink the prior snapshot to force a rename.
        const backoff = [10, 30, 100];
        for (let attempt = 0;; attempt++) {
            try {
                await rename(temporary, path);
                break;
            }
            catch (error) {
                const code = error.code;
                if (attempt >= backoff.length || !['EPERM', 'EBUSY', 'EACCES'].includes(code || ''))
                    throw error;
                await delay(backoff[attempt]);
            }
        }
        owned = false;
    }
    catch {
        throw new Error('Snapshot write unavailable');
    }
    finally {
        if (owned)
            await unlink(temporary).catch(() => undefined);
    }
}
