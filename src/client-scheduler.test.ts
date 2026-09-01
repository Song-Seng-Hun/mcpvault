import { expect, test } from 'vitest';
import { ClientRequestScheduler } from './client-scheduler.js';

test('coalesces identical work and respects the concurrency bound', async () => {
  const scheduler = new ClientRequestScheduler(1);
  const order: string[] = [];
  let executions = 0;
  const task = scheduler.run('same', async () => {
    executions += 1;
    order.push('same');
    await new Promise(resolve => setTimeout(resolve, 5));
    return 'done';
  });
  const duplicate = scheduler.run('same', async () => 'wrong');
  expect(await Promise.all([task, duplicate])).toEqual(['done', 'done']);
  expect(executions).toBe(1);
  expect(order).toEqual(['same']);
  expect(scheduler.running()).toBe(0);
});

test('runs higher priority queued work first', async () => {
  const scheduler = new ClientRequestScheduler(1);
  const order: string[] = [];
  let release!: () => void;
  const first = scheduler.run('first', async () => {
    order.push('first');
    await new Promise<void>(resolve => { release = resolve; });
  });
  const low = scheduler.run('low', async () => { order.push('low'); }, { priority: 1 });
  const high = scheduler.run('high', async () => { order.push('high'); }, { priority: 10 });
  await Promise.resolve();
  release();
  await Promise.all([first, low, high]);
  expect(order).toEqual(['first', 'high', 'low']);
});

test('does not execute an aborted queued task', async () => {
  const scheduler = new ClientRequestScheduler(1);
  let release!: () => void;
  const first = scheduler.run('first', async () => new Promise<void>(resolve => { release = resolve; }));
  const controller = new AbortController();
  const aborted = scheduler.run('aborted', async () => { throw new Error('should not run'); }, { signal: controller.signal });
  await Promise.resolve();
  controller.abort();
  release();
  await first;
  await expect(aborted).rejects.toThrow('aborted');
});

test('passes signals to running tasks and lets callers stop waiting', async () => {
  const scheduler = new ClientRequestScheduler(1);
  const controller = new AbortController();
  let receivedSignal: AbortSignal | undefined;
  const task = scheduler.run('running', signal => {
    receivedSignal = signal;
    return new Promise<void>((_resolve, reject) => {
      signal?.addEventListener('abort', () => reject(new Error('transport aborted')), { once: true });
    });
  }, { signal: controller.signal });
  await Promise.resolve();
  expect(receivedSignal).toBe(controller.signal);
  controller.abort();
  await expect(task).rejects.toThrow('aborted');
  expect(scheduler.running()).toBe(0);
});

test('coalesced callers can cancel their own wait without cancelling shared work', async () => {
  const scheduler = new ClientRequestScheduler(1);
  let release!: () => void;
  let runs = 0;
  const shared = scheduler.run('shared', async () => {
    runs += 1;
    await new Promise<void>(resolve => { release = resolve; });
    return 'done';
  });
  await Promise.resolve();
  const controller = new AbortController();
  const impatient = scheduler.run('shared', async () => 'wrong', { signal: controller.signal });
  controller.abort();
  await expect(impatient).rejects.toThrow('aborted');
  release();
  await expect(shared).resolves.toBe('done');
  expect(runs).toBe(1);
});

test('adapts concurrency to latency while keeping a hard bound', async () => {
  const scheduler = new ClientRequestScheduler({ maxConcurrency: 4, minConcurrency: 1, initialConcurrency: 1, adaptive: true, targetLatencyMs: 10 });
  expect(scheduler.currentConcurrency()).toBe(1);
  await scheduler.run('fast', async () => undefined);
  expect(scheduler.currentConcurrency()).toBe(2);
  await scheduler.run('slow', async () => new Promise<void>(resolve => setTimeout(resolve, 25)));
  expect(scheduler.currentConcurrency()).toBe(1);
  await expect(scheduler.run('failed', async () => { throw new Error('server overloaded'); })).rejects.toThrow('overloaded');
  expect(scheduler.currentConcurrency()).toBe(1);
});

test('keeps priority ordering with a large heap-backed queue', async () => {
  const scheduler = new ClientRequestScheduler(1);
  const order: string[] = [];
  let release!: () => void;
  const first = scheduler.run('first', async () => new Promise<void>(resolve => { release = resolve; }));
  const queued = Array.from({ length: 50 }, (_, index) => scheduler.run(`low-${index}`, async () => { order.push(`low-${index}`); }, { priority: index % 3 }));
  const high = scheduler.run('high', async () => { order.push('high'); }, { priority: 100 });
  await Promise.resolve();
  release();
  await Promise.all([first, high, ...queued]);
  expect(order[0]).toBe('high');
  expect(order).toHaveLength(51);
});
