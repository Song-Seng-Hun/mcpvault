import { afterEach, expect, test, vi } from 'vitest';
import { SemanticInferenceBusyError, SemanticInferenceGate } from './semantic-inference-gate.js';

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
afterEach(() => vi.useRealTimers());

test('serializes tasks and retains capacity until active completion', async () => {
  const gate = new SemanticInferenceGate(), started = deferred(), finish = deferred<number>();
  const calls: string[] = [];
  const first = gate.run('background', async () => { calls.push('first'); started.resolve(); return finish.promise; });
  await started.promise;
  const next = gate.run('foreground', async () => { calls.push('next'); return 2; });
  try { await Promise.resolve(); expect(calls).toEqual(['first']); }
  finally { finish.resolve(1); await Promise.allSettled([first, next]); }
  expect(await first).toBe(1); expect(await next).toBe(2);
});

test('caps waiting jobs at sixteen without invoking rejected work', async () => {
  const gate = new SemanticInferenceGate(), started = deferred(), finish = deferred();
  const first = gate.run('background', async () => { started.resolve(); await finish.promise; });
  await started.promise;
  const waiting = Array.from({ length: 16 }, (_, i) => gate.run('foreground', async () => i));
  let invoked = false;
  try { await expect(gate.run('foreground', async () => { invoked = true; })).rejects.toBeInstanceOf(SemanticInferenceBusyError); expect(invoked).toBe(false); }
  finally { finish.resolve(); await Promise.allSettled([first, ...waiting]); }
});

test('foreground priority cannot starve an admitted background task', async () => {
  const gate = new SemanticInferenceGate(), started = deferred(), finish = deferred();
  const order: string[] = [];
  const first = gate.run('background', async () => { started.resolve(); await finish.promise; });
  await started.promise;
  const background = gate.run('background', async () => { order.push('background'); });
  const foreground = Array.from({ length: 6 }, (_, i) => gate.run('foreground', async () => { order.push(`f${i}`); }));
  finish.resolve(); await Promise.all([first, background, ...foreground]);
  expect(order).toEqual(['f0', 'f1', 'f2', 'f3', 'background', 'f4', 'f5']);
});

test('queued work expires without interrupting the active task', async () => {
  vi.useFakeTimers();
  const gate = new SemanticInferenceGate(), started = deferred(), finish = deferred();
  let invoked = false, activeFinished = false;
  const first = gate.run('foreground', async () => { started.resolve(); await finish.promise; activeFinished = true; });
  await started.promise;
  const expired = gate.run('foreground', async () => { invoked = true; }).catch(error => error);
  try {
    await vi.advanceTimersByTimeAsync(5001);
    expect(invoked).toBe(false); expect(activeFinished).toBe(false);
    expect(await expired).toBeInstanceOf(SemanticInferenceBusyError);
  } finally { finish.resolve(); await first; }
  expect(vi.getTimerCount()).toBe(0);
  expect(await gate.run('foreground', async () => 'recovered')).toBe('recovered');
});

test('queued cancellation frees admission and never starts the cancelled task', async () => {
  const gate = new SemanticInferenceGate(), started = deferred(), finish = deferred(), controller = new AbortController();
  const first = gate.run('foreground', async () => { started.resolve(); await finish.promise; });
  await started.promise;
  let invoked = false;
  const cancelled = gate.run('foreground', async () => { invoked = true; }, controller.signal).catch(error => error);
  controller.abort();
  finish.resolve(); await first;
  expect(await cancelled).toBeInstanceOf(SemanticInferenceBusyError);
  expect(invoked).toBe(false);
  expect(await gate.run('foreground', async () => 3)).toBe(3);
});

test('cancelling active work does not release the execution slot prematurely', async () => {
  const gate = new SemanticInferenceGate(), started = deferred(), finish = deferred(), controller = new AbortController();
  let nextStarted = false;
  const first = gate.run('foreground', async () => { started.resolve(); await finish.promise; }, controller.signal);
  await started.promise; controller.abort();
  const next = gate.run('foreground', async () => { nextStarted = true; });
  try { await Promise.resolve(); expect(nextStarted).toBe(false); }
  finally { finish.resolve(); await Promise.allSettled([first, next]); }
});

test('pre-aborted tasks never execute and task errors do not poison the queue', async () => {
  const gate = new SemanticInferenceGate(), controller = new AbortController(); controller.abort();
  let invoked = false;
  await expect(gate.run('foreground', async () => { invoked = true; }, controller.signal)).rejects.toBeInstanceOf(SemanticInferenceBusyError);
  expect(invoked).toBe(false);
  await expect(gate.run('foreground', () => { throw new Error('native failed'); })).rejects.toThrow('native failed');
  expect(await gate.run('background', async () => 'ok')).toBe('ok');
});
