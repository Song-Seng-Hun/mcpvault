import { expect, test } from 'vitest';
import { ClientCapabilityCatalogCache, ClientHeartbeatBackoff } from './client-control-plane.js';
import type { ClientMcpCaller } from './client-control-plane.js';

test('caches capability catalog calls with TTL and coalesces concurrent requests', async () => {
  let now = 100;
  let calls = 0;
  const caller: ClientMcpCaller = {
    async callTool() {
      calls += 1;
      await new Promise(resolve => setTimeout(resolve, 5));
      return { endpoints: [{ endpointId: 'wiki.search' }] };
    },
  };
  const cache = new ClientCapabilityCatalogCache(caller, { ttlMs: 50, now: () => now });
  const [first, second] = await Promise.all([
    cache.search({ query: 'wiki', limit: 5 }),
    cache.search({ limit: 5, query: 'wiki' }),
  ]);
  expect(calls).toBe(1);
  expect(first).toEqual(second);
  now = 149;
  await cache.search({ query: 'wiki', limit: 5 });
  expect(calls).toBe(1);
  now = 150;
  await cache.search({ query: 'wiki', limit: 5 });
  expect(calls).toBe(2);
});

test('isolates capability cache partitions and backs off idle heartbeats', async () => {
  let calls = 0;
  const caller: ClientMcpCaller = { async callTool() { calls += 1; return { active: true }; } };
  const cache = new ClientCapabilityCatalogCache(caller, { ttlMs: 1000 });
  await cache.listActive({}, 'agent-a');
  await cache.listActive({}, 'agent-b');
  expect(calls).toBe(2);
  cache.invalidate('agent-a');
  await cache.listActive({}, 'agent-a');
  expect(calls).toBe(3);

  const backoff = new ClientHeartbeatBackoff({ minDelayMs: 10, maxDelayMs: 40, multiplier: 2, jitterRatio: 0 });
  expect(backoff.next(false)).toBe(10);
  expect(backoff.next(false)).toBe(20);
  expect(backoff.next(false)).toBe(40);
  expect(backoff.next(false)).toBe(40);
  expect(backoff.next(true)).toBe(10);
});

test('spreads heartbeat delays with bounded jitter', () => {
  const early = new ClientHeartbeatBackoff({ minDelayMs: 100, maxDelayMs: 1000, multiplier: 2, random: () => 0 });
  const late = new ClientHeartbeatBackoff({ minDelayMs: 100, maxDelayMs: 1000, multiplier: 2, random: () => 1 });
  expect(early.next(false)).toBe(100);
  expect(late.next(false)).toBe(110);
  expect(early.next(false)).toBe(180);
  expect(late.next(false)).toBe(220);
});
