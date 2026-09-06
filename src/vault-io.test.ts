import { describe, expect, test } from 'vitest';
import { VaultIoCoordinator } from './vault-io.js';
import { SourceReadLimitError } from './bounded-source-read.js';

describe('VaultIoCoordinator', () => {
  test('header-only reads coalesce without aliasing full, metadata, or revision reads', async () => {
    const calls: string[] = []; let active = 0, peak = 0;
    const read = async (key: string) => { calls.push(key); peak = Math.max(peak, ++active); await new Promise(resolve => setTimeout(resolve, 2)); active--; return key; };
    const io = new VaultIoCoordinator({ minConcurrency: 1, maxConcurrency: 1,
      headerReader: path => read(`header:${path}`), reader: path => read(`body:${path}`), revisionReader: path => read(`digest:${path}`),
      metadataReader: async path => ({ header: await read(`metadata:${path}`), revision: 'r' }),
    });
    const a = io.readUtf8Header('same'), b = io.readUtf8Header('same'); expect(a).toBe(b);
    expect(await Promise.all([a, b, io.readUtf8('same'), io.readUtf8Revision('same'), io.readUtf8Metadata('same')]))
      .toEqual(['header:same', 'header:same', 'body:same', 'digest:same', { header: 'metadata:same', revision: 'r' }]);
    expect(calls).toHaveLength(4); expect(peak).toBe(1);
    await io.readUtf8Header('same'); expect(calls).toHaveLength(5); expect(io.status()).toMatchObject({ active: 0, queued: 0 });
  });
  test('metadata admission deduplicates only identical keys and shares the existing scheduler', async () => {
    let active = 0, peak = 0; const calls: string[] = [];
    const read = async (key: string) => {
      calls.push(key); peak = Math.max(peak, ++active); await new Promise(resolve => setTimeout(resolve, 2)); active--; return key;
    };
    const io = new VaultIoCoordinator({ minConcurrency: 1, maxConcurrency: 1,
      reader: path => read(`body:${path}`), revisionReader: path => read(`digest:${path}`),
      metadataReader: async (path, cap) => Object.freeze({ header: await read(`${cap}:${path}`), revision: 'revision' }),
    });
    const a = io.readUtf8Metadata('same', 10), b = io.readUtf8Metadata('same', 10);
    expect(a).toBe(b);
    const values = await Promise.all([a, b, io.readUtf8Metadata('same', 20), io.readUtf8Metadata('same'), io.readUtf8('same'), io.readUtf8Revision('same')]);
    expect(values).toEqual([{ header: '10:same', revision: 'revision' }, { header: '10:same', revision: 'revision' },
      { header: '20:same', revision: 'revision' }, { header: 'undefined:same', revision: 'revision' }, 'body:same', 'digest:same']);
    expect(peak).toBe(1); expect(calls).toHaveLength(5); expect(io.status()).toMatchObject({ active: 0, queued: 0 });
  });
  test('invalid metadata limits never alias unbounded reads and failed reads release admission', async () => {
    let fail = false;
    const io = new VaultIoCoordinator({ metadataReader: async () => {
      if (fail) throw new SourceReadLimitError(); return Object.freeze({ header: '', revision: 'r' });
    } });
    const valid = io.readUtf8Metadata('same');
    for (const limit of [Infinity, NaN, -Infinity, 0, -1, 1.5, 0x80000000]) {
      await expect(io.readUtf8Metadata('same', limit)).rejects.toThrow('Invalid source byte limit');
    }
    await expect(valid).resolves.toEqual({ header: '', revision: 'r' });
    fail = true; const before = io.status().targetConcurrency;
    await expect(io.readUtf8Metadata('same')).rejects.toBeInstanceOf(SourceReadLimitError);
    expect(io.status().targetConcurrency).toBe(before);
    fail = false; await expect(io.readUtf8Metadata('same')).resolves.toMatchObject({ revision: 'r' });
  });
  test('invalid revision limits cannot coalesce with an unbounded in-flight digest', async () => {
    const io = new VaultIoCoordinator({ revisionReader: async () => 'digest' });
    const valid = io.readUtf8Revision('same');
    for (const limit of [Infinity, NaN, -Infinity, 0, -1, 1.5, 0x80000000]) {
      await expect(io.readUtf8Revision('same', limit)).rejects.toThrow('Invalid source byte limit');
    }
    await expect(valid).resolves.toBe('digest');
  });
  test('digests share the IO scheduler, coalesce identical caps, and never alias body reads', async () => {
    let active = 0, peak = 0; const calls: string[] = [];
    const reader = async (key: string) => {
      calls.push(key); peak = Math.max(peak, ++active);
      await new Promise(resolve => setTimeout(resolve, 2)); active--; return key;
    };
    const io = new VaultIoCoordinator({ minConcurrency: 1, maxConcurrency: 1,
      reader: path => reader(`body:${path}`), revisionReader: (path, cap) => reader(`${cap}:${path}`),
    });
    const a = io.readUtf8Revision('same', 10), b = io.readUtf8Revision('same', 10);
    expect(a).toBe(b);
    expect(await Promise.all([a, b, io.readUtf8Revision('same', 20), io.readUtf8Revision('same'), io.readUtf8('same')]))
      .toEqual(['10:same', '10:same', '20:same', 'undefined:same', 'body:same']);
    expect(peak).toBe(1); expect(calls).toHaveLength(4);
    expect(io.status()).toMatchObject({ active: 0, queued: 0 });
  });
  test('digest failures release admission and expected caps do not penalize IO', async () => {
    let fail = true;
    const io = new VaultIoCoordinator({ revisionReader: async () => {
      if (fail) { fail = false; throw new SourceReadLimitError(); } return 'retry';
    } });
    const before = io.status().targetConcurrency;
    await expect(io.readUtf8Revision('same', 10)).rejects.toBeInstanceOf(SourceReadLimitError);
    expect(io.status().targetConcurrency).toBe(before);
    await expect(io.readUtf8Revision('same', 10)).resolves.toBe('retry');
  });
  test('expected query size limits do not throttle unrelated IO as storage failures', async () => {
    const io = new VaultIoCoordinator({ boundedReader: async () => { throw new SourceReadLimitError(); } });
    const before = io.status().targetConcurrency;
    await expect(io.readUtf8Bounded('large.md', 64)).rejects.toBeInstanceOf(SourceReadLimitError);
    expect(io.status().targetConcurrency).toBe(before);
  });
  test('bounded reads share only matching limits and use the same scheduler', async () => {
    const calls: string[] = [];
    const io = new VaultIoCoordinator({ minConcurrency: 1, maxConcurrency: 1,
      reader: async path => { calls.push(`full:${path}`); return 'full'; },
      boundedReader: async (path, limit) => { calls.push(`${limit}:${path}`); return String(limit); },
    });
    const values = await Promise.all([io.readUtf8('same'), io.readUtf8Bounded('same', 64), io.readUtf8Bounded('same', 64), io.readUtf8Bounded('same', 128)]);
    expect(values).toEqual(['full', '64', '64', '128']);
    expect(calls).toEqual(['full:same', '64:same', '128:same']);
    expect(io.status()).toMatchObject({ active: 0, queued: 0 });
  });
  test('deduplicates concurrent reads of the same path', async () => {
    let reads = 0;
    const io = new VaultIoCoordinator({
      reader: async path => {
        reads += 1;
        await new Promise(resolve => setTimeout(resolve, 10));
        return path;
      },
    });

    const [first, second] = await Promise.all([io.readUtf8('same.md'), io.readUtf8('same.md')]);

    expect(first).toBe('same.md');
    expect(second).toBe('same.md');
    expect(reads).toBe(1);
    expect(io.status()).toMatchObject({ active: 0, queued: 0 });
  });

  test('prioritizes foreground reads over queued background work', async () => {
    const started: string[] = [];
    const io = new VaultIoCoordinator({
      minConcurrency: 1,
      maxConcurrency: 1,
      initialConcurrency: 1,
      reader: async path => {
        started.push(path);
        await new Promise(resolve => setTimeout(resolve, 5));
        return path;
      },
    });

    const background = io.readUtf8('background.md', 'background');
    const queuedBackground = io.readUtf8('queued-background.md', 'background');
    await new Promise(resolve => setTimeout(resolve, 0));
    const foreground = io.readUtf8('foreground.md', 'foreground');
    await Promise.all([background, queuedBackground, foreground]);

    expect(started).toEqual(['background.md', 'foreground.md', 'queued-background.md']);
  });

  test('reduces concurrency after a failed read without rejecting other jobs', async () => {
    let failed = false;
    const io = new VaultIoCoordinator({
      reader: async path => {
        if (!failed) {
          failed = true;
          throw new Error('read failed');
        }
        return path;
      },
    });

    await expect(io.readUtf8('broken.md')).rejects.toThrow('read failed');
    await expect(io.readUtf8('healthy.md')).resolves.toBe('healthy.md');
    expect(io.status().targetConcurrency).toBeLessThanOrEqual(8);
  });
});
