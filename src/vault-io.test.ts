import { describe, expect, test } from 'vitest';
import { VaultIoCoordinator } from './vault-io.js';

describe('VaultIoCoordinator', () => {
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
