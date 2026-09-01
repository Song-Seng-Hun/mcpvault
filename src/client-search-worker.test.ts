import { expect, test } from 'vitest';
import { attachClientSearchWorker, ClientSearchWorkerClient, ClientSearchWorkerPool, type ClientSearchWorkerRuntime } from './client-search-worker.js';

class FakeRuntime implements ClientSearchWorkerRuntime {
  private readonly listeners = new Set<(event: { data: unknown }) => void>();

  postMessage(message: unknown): void {
    queueMicrotask(() => {
      for (const listener of this.listeners) listener({ data: message });
    });
  }

  addEventListener(_type: 'message', listener: (event: { data: unknown }) => void): void {
    this.listeners.add(listener);
  }

  removeEventListener(_type: 'message', listener: (event: { data: unknown }) => void): void {
    this.listeners.delete(listener);
  }
}

test('runs local search indexing through a worker-compatible runtime', async () => {
  const runtime = new FakeRuntime();
  const detach = attachClientSearchWorker(runtime);
  const client = new ClientSearchWorkerClient(runtime);
  await client.upsertMany([
    { path: 'worker.md', revision: 'a'.repeat(64), content: 'worker indexed note' },
    { path: 'other.md', revision: 'b'.repeat(64), content: 'unrelated' },
  ], { batchSize: 1 });
  const result = await client.search('worker');
  expect(result.complete).toBe(false);
  expect(result.results[0]!.path).toBe('worker.md');
  const snapshot = await client.snapshot();
  await client.clear();
  expect((await client.search('worker')).results).toHaveLength(0);
  expect(await client.restore(snapshot)).toBe(2);
  expect((await client.search('worker')).results[0]!.path).toBe('worker.md');
  client.close();
  detach();
});

test('can cancel a worker-side background index refresh', async () => {
  const runtime = new FakeRuntime();
  const detach = attachClientSearchWorker(runtime);
  const client = new ClientSearchWorkerClient(runtime);
  const controller = new AbortController();
  const pending = client.upsertMany(Array.from({ length: 5 }, (_, index) => ({
    path: `cancel-${index}.md`,
    revision: String(index).repeat(64),
    content: `cancel ${index}`,
  })), { batchSize: 1, signal: controller.signal });
  controller.abort();
  await expect(pending).rejects.toThrow('aborted');
  client.close();
  detach();
});

test('shards documents across a bounded worker pool and merges top results', async () => {
  const detach: Array<() => void> = [];
  const pool = new ClientSearchWorkerPool({
    workerCount: 2,
    createRuntime: () => {
      const runtime = new FakeRuntime();
      detach.push(attachClientSearchWorker(runtime));
      return runtime;
    },
  });
  await pool.upsertMany([
    { path: 'pool-a.md', revision: 'a'.repeat(64), content: 'pool target target' },
    { path: 'pool-b.md', revision: 'b'.repeat(64), content: 'pool target' },
    { path: 'pool-c.md', revision: 'c'.repeat(64), content: 'different' },
  ], { batchSize: 1 });
  const result = await pool.search('target', { limit: 2 });
  expect(result.complete).toBe(false);
  expect(result.indexedDocuments).toBe(3);
  expect(result.results).toHaveLength(2);
  expect(result.results[0]!.path).toBe('pool-a.md');
  pool.close();
  for (const dispose of detach) dispose();
});
