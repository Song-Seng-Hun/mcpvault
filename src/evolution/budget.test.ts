import { expect, test } from 'vitest';
import * as budget from './budget.js';
import { memoryStorage } from '../../tests/evolution-test-fixture.js';

function fixture() {
  const { storage } = memoryStorage(); let now = 1000000000;
  const create = () => new budget.EvolutionBudget(storage, async () => {}, () => now);
  return { create, advance: () => { now += 86400001; } };
}

test('automatic budget is ten percent of foreground usage, includes reservations and deduplicates events', async () => {
  expect(budget.EvolutionBudget).toBeTypeOf('function');
  const f = fixture(), b = f.create();
  await expect(b.reserve('alice', 'request', 1)).rejects.toThrow();
  await b.recordForeground('alice', 'event1', 1000);
  await b.recordForeground('alice', 'event1', 1000);
  await b.reserve('alice', 'request', 80);
  await expect(b.reserve('alice', 'second', 21)).rejects.toThrow();
  await b.settle('alice', 'request', 40);
  await f.create().reserve('alice', 'second', 60);
  await expect(b.reserve('bob', 'other', 1)).rejects.toThrow();
});

test('unknown or interrupted usage freezes automatic calls across restarts, not forgotten on expiry', async () => {
  const f = fixture(), b = f.create();
  await b.recordForeground('alice', 'event1', 1000); await b.reserve('alice', 'call1', 80);
  await b.settle('alice', 'call1', undefined);
  await expect(f.create().reserve('alice', 'call2', 1)).rejects.toThrow();
  f.advance(); await b.recordForeground('alice', 'event2', 1000);
  await expect(f.create().reserve('alice', 'call2', 1)).rejects.toThrow();
  await b.settle('alice', 'call1', 80); await b.reserve('alice', 'call2', 20);
  await expect(b.settle('alice', 'call1', 0)).rejects.toThrow();
});

test('foreground window expires, late replay cannot replenish it, cancelled known usage is charged', async () => {
  const f = fixture(), b = f.create();
  await b.recordForeground('alice', 'event1', 1000);
  await b.reserve('alice', 'cancelled', 80); await b.settle('alice', 'cancelled', 80);
  f.advance(); await b.recordForeground('alice', 'event1', 1000);
  await expect(b.reserve('alice', 'later', 1)).rejects.toThrow();
  await expect(b.recordForeground('alice', 'event1', 2000)).rejects.toThrow();
});
