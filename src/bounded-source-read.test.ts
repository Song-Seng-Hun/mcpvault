import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readBoundedSource, SourceReadLimitError } from './bounded-source-read.js';

const growth = vi.hoisted(() => ({ path: '', readBytes: 0, closed: false }));
vi.mock('node:fs/promises', async importOriginal => {
  const real = await importOriginal<typeof import('node:fs/promises')>();
  return { ...real, open: async (...args: Parameters<typeof real.open>) => {
    const handle = await real.open(...args);
    if (String(args[0]) === growth.path) {
      const stat = handle.stat.bind(handle), read = handle.read.bind(handle), close = handle.close.bind(handle);
      handle.stat = (async () => { const info = await stat(); await real.appendFile(growth.path, 'x'.repeat(100)); return info; }) as typeof handle.stat;
      handle.read = (async (...readArgs: any[]) => { const result = await (read as any)(...readArgs); growth.readBytes += result.bytesRead; return result; }) as typeof handle.read;
      handle.close = async () => { await close(); growth.closed = true; };
    }
    return handle;
  } };
});
let directory: string, path: string;
beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), 'mcpvault-source-read-')); path = join(directory, 'source.md'); });
afterEach(async () => { growth.path = ''; growth.readBytes = 0; growth.closed = false; await rm(directory, { recursive: true, force: true }); });
test('source boundary counts raw UTF-8 bytes, not characters', async () => {
  await writeFile(path, '한글');
  expect(await readBoundedSource(path, 6)).toBe('한글');
  await expect(readBoundedSource(path, 5)).rejects.toBeInstanceOf(SourceReadLimitError);
});
test('growing sources read no more than ceiling plus one byte and close', async () => {
  await writeFile(path, 'a'); growth.path = path;
  await expect(readBoundedSource(path, 64)).rejects.toBeInstanceOf(SourceReadLimitError);
  expect(growth.readBytes).toBe(65); expect(growth.closed).toBe(true);
});
test('missing sources retain their native classification for the service boundary', async () => {
  await expect(readBoundedSource(path, 64)).rejects.toMatchObject({ code: 'ENOENT' });
});
test.each([0, -1, 1.5, Infinity])('invalid limit %s rejects before source IO', async limit => {
  await expect(readBoundedSource(path, limit)).rejects.toThrow('Invalid source byte limit');
});
test('directories are not raw source documents', async () => {
  await expect(readBoundedSource(directory, 64)).rejects.toThrow('Source is not a regular file');
});
