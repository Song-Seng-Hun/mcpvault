import { open } from 'node:fs/promises';
export class SourceReadLimitError extends Error {
    constructor() { super('Source exceeds query read budget'); this.name = 'SourceReadLimitError'; }
}
/** Read a complete UTF-8 source or reject; never pass partial Markdown to a parser. */
export async function readBoundedSource(path, maxBytes) {
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 0x7fffffff)
        throw new TypeError('Invalid source byte limit');
    const handle = await open(path, 'r');
    try {
        const info = await handle.stat();
        if (!info.isFile())
            throw new Error('Source is not a regular file');
        if (info.size > maxBytes)
            throw new SourceReadLimitError();
        const chunks = [];
        let size = 0;
        for (;;) {
            const chunk = Buffer.allocUnsafe(Math.min(64 * 1024, maxBytes - size + 1));
            const { bytesRead } = await handle.read(chunk, 0, chunk.length, null);
            if (!bytesRead)
                return Buffer.concat(chunks, size).toString('utf8');
            size += bytesRead;
            if (size > maxBytes)
                throw new SourceReadLimitError();
            chunks.push(chunk.subarray(0, bytesRead));
        }
    }
    finally {
        await handle.close();
    }
}
