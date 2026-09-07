import { expect, test } from 'vitest';
import { createServerLifecycle } from './server-lifecycle.js';

test('shutdown releases transports before the runtime, exactly once across concurrent calls', async () => {
  const closed: string[] = [];
  const lifecycle = createServerLifecycle({ close: async () => { closed.push('runtime'); } });
  lifecycle.add({ close: async () => { closed.push('stdio'); } });
  lifecycle.add({ close: async () => { closed.push('http'); } });
  const first = lifecycle.close(), second = lifecycle.close();
  expect(first).toBe(second);
  expect(await first).toEqual([]);
  await second;
  expect(closed).toEqual(['http', 'stdio', 'runtime']);
  expect(() => lifecycle.add({ close: async () => {} })).toThrow('closing');
});

test('a rejected closer does not skip other transports or root cleanup', async () => {
  const closed: string[] = [], failure = new Error('fixture close failed');
  const lifecycle = createServerLifecycle({ close: async () => { closed.push('runtime'); throw failure; } });
  lifecycle.add({ close: async () => { closed.push('stdio'); } });
  lifecycle.add({ close: () => { closed.push('http'); throw failure; } });
  expect(await lifecycle.close()).toEqual([failure, failure]);
  expect(closed).toEqual(['http', 'stdio', 'runtime']);
});

test('an idle root is closed even if no protocol handle was ever acquired', async () => {
  let count = 0;
  const lifecycle = createServerLifecycle({ close: async () => { count++; } });
  await lifecycle.close();
  await lifecycle.close();
  expect(count).toBe(1);
});
