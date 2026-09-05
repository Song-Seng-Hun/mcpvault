import { describe, expect, test } from 'vitest';
import { VaultIoCoordinator } from './vault-io.js';
import { SourceReadLimitError } from './bounded-source-read.js';

describe('VaultIoCoordinator', () => {
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
