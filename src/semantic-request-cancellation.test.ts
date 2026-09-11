import { afterEach, expect, test, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SemanticSearchService } from './semantic-search.js';
import { PathFilter } from './pathfilter.js';
import { ScopeAccessPolicy } from './scope-access.js';
import { semanticInferenceGate } from './semantic-inference-gate.js';
import { RetrievalService } from './retrieval-service.js';

afterEach(() => vi.useRealTimers());
function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }
test.each(['retrieve', 'memoryCandidates'] as const)('%s deadline aborts the optional backend request', async method => {
  vi.useFakeTimers();
  let signal: AbortSignal | undefined;
  const started = deferred();
  const backend = async (params: any) => { signal = params.signal; started.resolve(); return new Promise<any>(() => {}); };
  const service = new RetrievalService({ memoryCandidates: async () => ({ results: [], complete: true }) } as any,
    { searchScopedNotes: async () => [] } as any, { search: backend, memoryCandidates: backend }, new ScopeAccessPolicy(), {} as any);
  const request = service[method]({ query: 'needle', semantic: true, canAccessPath: () => true });
  await started.promise;
  await vi.advanceTimersByTimeAsync(2001);
  expect((await request).semantic.state).toBe('unavailable');
  expect(signal?.aborted).toBe(true);
});

test.each([false, true])('queued query cancellation preserves a surviving subscriber: %s', async survivor => {
  const root = await mkdtemp(join(tmpdir(), 'semantic-cancel-'));
  const service = new SemanticSearchService(root, new PathFilter());
  const finish = deferred(), started = deferred();
  const active = semanticInferenceGate.run('background', async () => { started.resolve(); await finish.promise; });
  await started.promise;
  const native = vi.fn(async () => ({ tolist: () => [Array(384).fill(0)] }));
  vi.spyOn(service as any, 'getEmbedder').mockResolvedValue(native);
  const controller = new AbortController();
  const first = (service as any).embedQuery('needle', controller.signal).catch((error: Error) => error);
  const second = survivor ? (service as any).embedQuery('needle') : undefined;
  controller.abort();
  finish.resolve();
  try {
    await active;
    expect(await first).toBeInstanceOf(Error);
    if (second) expect(await second).toHaveLength(384);
    await Promise.resolve();
    expect(native).toHaveBeenCalledTimes(survivor ? 1 : 0);
  } finally { finish.resolve(); await active; await service.close(); await rm(root, { recursive: true, force: true }); }
});
