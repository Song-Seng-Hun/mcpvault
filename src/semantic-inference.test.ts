import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { basename, isAbsolute, join, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { setImmediate as flush } from 'node:timers/promises';
import { getEventListeners } from 'node:events';
import { PathFilter } from './pathfilter.js';
import type { SemanticSearchService } from './semantic-search.js';

function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }
const model = vi.hoisted(() => ({
  loads: 0, disposed: 0, active: 0, peak: 0, calls: [] as Array<string | string[]>,
  load: undefined as (() => Promise<void>) | undefined,
  run: undefined as ((text: string | string[]) => Promise<void>) | undefined,
}));
vi.mock('@huggingface/transformers', () => ({
  env: { allowLocalModels: true },
  pipeline: async () => {
    model.loads++; await model.load?.();
    return Object.assign(async (text: string | string[]) => {
      model.calls.push(text); model.active++; model.peak = Math.max(model.peak, model.active);
      try { await model.run?.(text); return { tolist: () => Array.from({ length: Array.isArray(text) ? text.length : 1 }, () => Array(384).fill(1)) }; }
      finally { model.active--; }
    }, { dispose: async () => { model.disposed++; } });
  },
}));

let root: string;
let services: SemanticSearchService[];
async function service(): Promise<any> {
  const { SemanticSearchService } = await import('./semantic-search.js');
  const path = join(root, String(services.length)); await mkdir(path);
  const instance = new SemanticSearchService(path, new PathFilter()); services.push(instance);
  await Promise.all([(instance as any).manifestReady, (instance as any).pendingReady]);
  return instance;
}
beforeEach(async () => {
  vi.resetModules(); vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  Object.assign(model, { loads: 0, disposed: 0, active: 0, peak: 0, calls: [], load: undefined, run: undefined });
  services = []; root = await mkdtemp(join(tmpdir(), 'mcpvault-inference-'));
});
afterEach(async () => {
  for (const instance of services) await instance.close();
  await vi.advanceTimersByTimeAsync(60001);
  vi.useRealTimers(); vi.restoreAllMocks();
  const target = await realpath(root), local = relative(await realpath(tmpdir()), target);
  if (!local || local.startsWith('..') || isAbsolute(local) || !basename(target).startsWith('mcpvault-inference-')) throw new Error('Unsafe test cleanup');
  await rm(target, { recursive: true, force: true });
});

test('different services share one active inference and reuse the model', async () => {
  const a = await service(), b = await service(), entered = deferred(), finish = deferred();
  model.run = async text => { if (text === 'query: slow') { entered.resolve(); await finish.promise; } };
  const first = a.embed('slow', 'query'); await entered.promise;
  const second = b.embed('fast', 'query');
  try { await flush(); expect(model.calls).toEqual(['query: slow']); expect(model.peak).toBe(1); }
  finally { finish.resolve(); await Promise.allSettled([first, second]); }
  expect(await second).toHaveLength(384); expect(model.loads).toBe(1);
});

test('close cancels queued inference and waits for a pending model load without leaking its lease', async () => {
  const a = await service(), entered = deferred(), finish = deferred();
  model.load = async () => { entered.resolve(); await finish.promise; };
  const first = a.embed('first', 'query').catch((error: unknown) => error);
  await entered.promise;
  const second = a.embed('second', 'query').catch((error: unknown) => error);
  let closed = false;
  const closing = a.close().then(() => { closed = true; });
  try { await flush(); expect(closed).toBe(false); }
  finally { finish.resolve(); await Promise.allSettled([first, second, closing]); }
  expect(model.calls).toEqual([]);
  await vi.advanceTimersByTimeAsync(60001);
  expect(model.disposed).toBe(1);
  expect(a.embedderLease).toBeUndefined();
});

test('single-input batch fallback runs within the same admission without deadlock', async () => {
  const a = await service();
  model.run = async text => { if (Array.isArray(text)) throw new Error('array unsupported'); };
  expect(await a.embedMany(['a', 'b'], 'passage')).toHaveLength(2);
  expect(model.calls).toEqual([['passage: a', 'passage: b'], 'passage: a', 'passage: b']);
  expect(model.peak).toBe(1);
});

test('busy foreground inference is temporary and does not disable later semantic searches', async () => {
  const a = await service(), { SemanticInferenceBusyError } = await import('./semantic-inference-gate.js');
  vi.spyOn(a, 'acquireIndexLease').mockResolvedValue(false);
  vi.spyOn(a, 'getTableNames').mockResolvedValue(new Set(['chunks_global']));
  const embed = vi.spyOn(a, 'embedQuery').mockRejectedValue(new SemanticInferenceBusyError());
  const busy = await a.search({ query: 'one' });
  expect(busy.available).toBe(false); expect(busy.error).toContain('busy');
  expect(a.unavailableUntil).toBe(0); expect(a.lastError).toBeUndefined();
  embed.mockResolvedValue(Array(384).fill(1));
  vi.spyOn(a, 'getTable').mockResolvedValue({
    schema: async () => ({ fields: [{ name: 'embeddingProfile' }] }),
    vectorSearch() { return { where() { return this; }, distanceType() { return this; }, limit() { return this; }, toArray: async () => [] }; },
  });
  expect((await a.search({ query: 'one' })).available).toBe(true);
});

test('busy background work keeps its pending Markdown intent and does not trip global backoff', async () => {
  const a = await service(), { SemanticInferenceBusyError } = await import('./semantic-inference-gate.js');
  await writeFile(join(a.vaultPath, 'Note.md'), '# Note');
  a.notifyChange('Note.md', 'upsert'); a.semanticActive = true;
  vi.spyOn(a, 'acquireIndexLease').mockResolvedValue(true);
  vi.spyOn(a, 'scanForChanges').mockResolvedValue(undefined);
  vi.spyOn(a, 'prepareIndex').mockRejectedValue(new SemanticInferenceBusyError());
  await a.runIdleWork();
  expect(a.pending.has('Note.md')).toBe(true);
  expect(a.unavailableUntil).toBe(0); expect(a.lastError).toBeUndefined();
});

test('closed services do not load a model for later inference requests', async () => {
  const a = await service(); await a.close();
  await expect(a.embed('late', 'query')).rejects.toThrow();
  expect(model.loads).toBe(0);
});

test('saturation rejects a batch without fallback and closing a queued owner removes all listeners', async () => {
  const a = await service(), b = await service(), entered = deferred(), finish = deferred();
  const { SemanticInferenceBusyError } = await import('./semantic-inference-gate.js');
  model.run = async text => { if (text === 'query: active') { entered.resolve(); await finish.promise; } };
  const first = a.embed('active', 'query'); await entered.promise;
  const waiting = Array.from({ length: 16 }, (_, i) => b.embed(`queued-${i}`, 'query').catch((error: unknown) => error));
  try {
    expect(getEventListeners(b.inferenceAbort.signal, 'abort')).toHaveLength(16);
    await expect(b.embedMany(['never', 'fallback'], 'passage')).rejects.toBeInstanceOf(SemanticInferenceBusyError);
    await b.close();
    expect(getEventListeners(b.inferenceAbort.signal, 'abort')).toHaveLength(0);
    expect(model.calls).toEqual(['query: active']);
    expect(model.active).toBe(1);
    expect((await Promise.all(waiting)).every(error => error instanceof SemanticInferenceBusyError)).toBe(true);
  } finally { finish.resolve(); await Promise.allSettled([first, ...waiting]); }
});

test('close and idle cleanup retain a lease until an active native call settles', async () => {
  const a = await service(), entered = deferred(), finish = deferred();
  model.run = async () => { entered.resolve(); await finish.promise; };
  const first = a.embed('active', 'query'); await entered.promise;
  let closed = false;
  const closing = a.close().then(() => { closed = true; });
  try {
    await vi.advanceTimersByTimeAsync(60001);
    expect(closed).toBe(false); expect(model.active).toBe(1); expect(model.disposed).toBe(0);
  } finally { finish.resolve(); await Promise.allSettled([first, closing]); }
  await vi.advanceTimersByTimeAsync(60001);
  expect(model.disposed).toBe(1);
});

test('closing a real queued drain preserves intent without recreating snapshot timers or files', async () => {
  const a = await service(), b = await service(), entered = deferred(), finish = deferred(), queued = deferred();
  model.run = async text => { if (text === 'query: active') { entered.resolve(); await finish.promise; } };
  const active = a.embed('active', 'query'); await entered.promise;
  await writeFile(join(b.vaultPath, 'Note.md'), '# Note');
  vi.spyOn(b, 'reusableVectors').mockResolvedValue(new Map());
  const embedMany = b.embedMany.bind(b);
  vi.spyOn(b, 'embedMany').mockImplementation((...args: any[]) => { const result = embedMany(...args); queued.resolve(); return result; });
  const snapshots = vi.spyOn(b, 'flushPendingSnapshot');
  b.notifyChange('Note.md', 'upsert');
  const indexing = b.drain(1).catch((error: unknown) => error);
  await queued.promise;
  try {
    await b.close(); await indexing;
    expect(b.pending.has('Note.md')).toBe(true);
    expect(b.pendingSnapshotTimer).toBeUndefined();
    await vi.advanceTimersByTimeAsync(2000);
    expect(snapshots).not.toHaveBeenCalled();
    expect(await readdir(b.vaultPath)).toEqual(['Note.md']);
    expect(await readFile(join(b.vaultPath, 'Note.md'), 'utf8')).toBe('# Note');
  } finally { finish.resolve(); await Promise.allSettled([active, indexing]); }
});

test('repeated busy indexing retains a short retry without accumulating native failure attempts', async () => {
  const a = await service(), { SemanticInferenceBusyError } = await import('./semantic-inference-gate.js');
  await writeFile(join(a.vaultPath, 'Note.md'), '# Note'); a.notifyChange('Note.md', 'upsert');
  vi.spyOn(a, 'prepareIndex').mockRejectedValue(new SemanticInferenceBusyError());
  const now = Date.now(); vi.spyOn(Date, 'now').mockReturnValue(now);
  for (let i = 0; i < 8; i++) {
    await expect(a.drain(1)).rejects.toBeInstanceOf(SemanticInferenceBusyError);
    const pending = a.pending.get('Note.md');
    expect(pending.attempt || 0).toBe(0);
    expect(pending.retryAt).toBe(now + 1000);
    pending.retryAt = now;
  }
});
