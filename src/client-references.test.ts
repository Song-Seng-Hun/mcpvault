import { expect, test } from 'vitest';
import { ClientReferenceCache } from './client-references.js';
import type { ClientEndpointCaller } from './client-cache.js';

test('reuses reference resolution for the same source revision and request', async () => {
  let calls = 0;
  const caller: ClientEndpointCaller = {
    async callEndpoint(_endpointId, arguments_) {
      calls += 1;
      return { source: arguments_.path, references: [{ path: 'evidence.md' }], total: 1 };
    },
  };
  const cache = new ClientReferenceCache(caller);
  const first = await cache.read('post.md', 'a', { includeContent: false });
  const second = await cache.read('post.md', 'a', { includeContent: false });
  expect(calls).toBe(1);
  expect(second).toEqual(first);
  expect(first).not.toBe(second);
  await cache.read('post.md', 'b', { includeContent: false });
  expect(calls).toBe(2);
});

test('coalesces concurrent private reads without sharing cache partitions', async () => {
  let calls = 0;
  const caller: ClientEndpointCaller = {
    async callEndpoint() {
      calls += 1;
      await new Promise(resolve => setTimeout(resolve, 5));
      return { references: [] };
    },
  };
  const cache = new ClientReferenceCache(caller);
  await Promise.all([
    cache.read('scope://agent/a/note.md', 'a', { cachePartition: 'agent-a' }),
    cache.read('scope://agent/a/note.md', 'a', { cachePartition: 'agent-a' }),
  ]);
  await cache.read('scope://agent/a/note.md', 'a', { cachePartition: 'agent-b' });
  expect(calls).toBe(2);
});

test('cancels obsolete reference waits and forwards the signal', async () => {
  const controller = new AbortController();
  let received: AbortSignal | undefined;
  const caller: ClientEndpointCaller = {
    async callEndpoint(_endpointId, _arguments, options) {
      received = options?.signal;
      await new Promise<void>((_resolve, reject) => options?.signal?.addEventListener('abort', () => reject(new Error('transport aborted')), { once: true }));
      return {};
    },
  };
  const cache = new ClientReferenceCache(caller);
  const pending = cache.read('note.md', 'a'.repeat(64), { signal: controller.signal });
  controller.abort();
  await expect(pending).rejects.toThrow('aborted');
  expect(received).toBe(controller.signal);
});
