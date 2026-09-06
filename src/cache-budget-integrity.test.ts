import { expect, test, vi } from 'vitest';
import { DerivedCacheBudget } from './cache-budget.js';

test.each([
  ['NaN', NaN], ['Infinity', Infinity], ['negative Infinity', -Infinity],
  ['negative', -1], ['unsafe integer', Number.MAX_SAFE_INTEGER + 1],
  ['undefined', undefined], ['numeric string', '4'],
] as const)('%s charges are disposed without poisoning subsequent enforcement', (_label, charge) => {
  const budget = new DerivedCacheBudget(10), evicted: string[] = [];
  budget.register('x', 'bad', charge as number, () => evicted.push('bad'), { allowOversized: true });
  expect(budget.snapshot()).toEqual({ maxBytes: 10, totalBytes: 0, entries: 0 });
  expect(evicted).toEqual(['bad']);
  budget.register('x', 'a', 8, () => evicted.push('a'));
  budget.register('x', 'b', 8, () => evicted.push('b'));
  expect(budget.snapshot()).toEqual({ maxBytes: 10, totalBytes: 8, entries: 1 });
  expect(evicted).toEqual(['bad', 'a']);
});

test('invalid replacement disposes the new value and preserves other owners', () => {
  const budget = new DerivedCacheBudget(20), old = vi.fn(), fresh = vi.fn(), other = vi.fn();
  budget.register('owner', 'key', 6, old);
  budget.register('other', 'key', 4, other);
  budget.register('owner', 'key', NaN, fresh);
  expect(fresh).toHaveBeenCalledTimes(1); expect(old).not.toHaveBeenCalled(); expect(other).not.toHaveBeenCalled();
  expect(budget.snapshot()).toEqual({ maxBytes: 20, totalBytes: 4, entries: 1 });
  budget.clearOwner('owner');
  expect(budget.snapshot().totalBytes).toBe(4);
});

test('bad-charge cleanup may throw or reenter without poisoning the ledger', () => {
  const budget = new DerivedCacheBudget(10);
  expect(() => budget.register('x', 'throws', NaN, () => { throw new Error('disposer failure'); })).not.toThrow();
  let calls = 0;
  budget.register('x', 'reenter', NaN, () => { calls++; budget.register('good', 'value', 8, () => undefined); });
  expect(calls).toBe(1);
  expect(budget.snapshot()).toEqual({ maxBytes: 10, totalBytes: 8, entries: 1 });
});

test('store-before-register callers still return results while invalid estimates remove only the cache copy', () => {
  const budget = new DerivedCacheBudget(10), cache = new Map<string, { revision: number }>();
  let revision = 0;
  const read = (bytes: number) => {
    const existing = cache.get('key'); if (existing) return existing;
    const result = { revision: ++revision }; cache.set('key', result);
    budget.register('owner', 'key', bytes, () => { if (cache.get('key') === result) cache.delete('key'); });
    return result;
  };
  expect(read(NaN)).toEqual({ revision: 1 }); expect(cache.size).toBe(0);
  expect(read(Infinity)).toEqual({ revision: 2 }); expect(cache.size).toBe(0);
  expect(read(5)).toEqual({ revision: 3 }); expect(read(5)).toEqual({ revision: 3 });
  expect(budget.snapshot()).toEqual({ maxBytes: 10, totalBytes: 5, entries: 1 });
});

test('non-number charges are never coerced or admitted', () => {
  const budget = new DerivedCacheBudget(10);
  const coerce = vi.fn(() => { throw new Error('must not coerce'); });
  let disposed = 0;
  for (const value of [1n, Symbol('bytes'), { valueOf: coerce }]) {
    expect(() => budget.register('x', 'key', value as unknown as number, () => { disposed++; })).not.toThrow();
  }
  expect(coerce).not.toHaveBeenCalled(); expect(disposed).toBe(3);
  expect(budget.snapshot().entries).toBe(0); expect(budget.snapshot().totalBytes).toBe(0);
});

test('invalid disposal may replace the same owner/key with a valid registration', () => {
  const budget = new DerivedCacheBudget(10);
  budget.register('x', 'same', NaN, () => budget.register('x', 'same', 4, () => undefined));
  expect(budget.snapshot()).toEqual({ maxBytes: 10, totalBytes: 4, entries: 1 });
  budget.remove('x', 'same'); expect(budget.snapshot().entries).toBe(0); expect(budget.snapshot().totalBytes).toBe(0);
});

test('over-budget callback snapshots remain JSON-safe numbers while the internal ledger is exact', () => {
  const maximum = Number.MAX_SAFE_INTEGER, budget = new DerivedCacheBudget(maximum);
  let observed: ReturnType<DerivedCacheBudget['snapshot']> | undefined, encoded = '';
  budget.register('x', 'a', 1, () => { observed = budget.snapshot(); encoded = JSON.stringify(observed); });
  budget.register('x', 'b', maximum - 1, () => undefined);
  budget.register('x', 'new', maximum, () => undefined);
  expect(observed?.totalBytes).toBe(Number(2n * BigInt(maximum) - 1n));
  expect(typeof observed?.totalBytes).toBe('number');
  expect(JSON.parse(encoded)).toEqual(observed);
  expect(budget.snapshot()).toEqual({ maxBytes: maximum, totalBytes: maximum, entries: 1 });
});

test.each([NaN, Infinity, -1, 0, Number.MAX_SAFE_INTEGER + 1])('invalid maximum %s is rejected', max => {
  expect(() => new DerivedCacheBudget(max)).toThrow(/maxBytes/);
});

test('large safe-integer oversized replacement keeps the exact small remainder', () => {
  const budget = new DerivedCacheBudget(10), evicted: string[] = [];
  budget.register('x', 'large', Number.MAX_SAFE_INTEGER, () => evicted.push('large'), { allowOversized: true });
  expect(budget.snapshot().totalBytes).toBe(Number.MAX_SAFE_INTEGER);
  budget.register('x', 'small', 2, () => evicted.push('small'));
  expect(evicted).toEqual(['large']);
  expect(budget.snapshot()).toEqual({ maxBytes: 10, totalBytes: 2, entries: 1 });
  budget.remove('x', 'small'); expect(budget.snapshot().totalBytes).toBe(0);
});

test('large normal maximum keeps exact accounting through overflow-sized intermediate sums', () => {
  const budget = new DerivedCacheBudget(Number.MAX_SAFE_INTEGER);
  budget.register('x', 'large', Number.MAX_SAFE_INTEGER - 1, () => undefined);
  budget.register('x', 'small', 4, () => undefined);
  expect(budget.snapshot().totalBytes).toBe(4); expect(budget.snapshot().entries).toBe(1);
});

test('zero and rounded-up charges preserve fractional maximum behavior', () => {
  const budget = new DerivedCacheBudget(2.5), evicted: string[] = [];
  budget.register('x', 'zero', 0, () => evicted.push('zero'));
  budget.register('x', 'one', 0.1, () => evicted.push('one'));
  budget.register('x', 'two', 1.1, () => evicted.push('two'));
  expect(evicted).toEqual(['zero', 'one']);
  expect(budget.snapshot()).toEqual({ maxBytes: 2.5, totalBytes: 2, entries: 1 });
});

test('nested eviction registration keeps large intermediate totals exact', () => {
  const budget = new DerivedCacheBudget(31), evicted: string[] = [];
  budget.register('x', 'a', 1, () => {
    evicted.push('a');
    budget.register('x', 'during', Number.MAX_SAFE_INTEGER, () => evicted.push('during'), { allowOversized: true });
  });
  budget.register('x', 'b', 30, () => evicted.push('b'));
  budget.register('x', 'trigger', Number.MAX_SAFE_INTEGER, () => evicted.push('trigger'), { allowOversized: true });
  expect(evicted).toEqual(['a', 'b', 'trigger']);
  expect(budget.snapshot()).toEqual({ maxBytes: 31, totalBytes: Number.MAX_SAFE_INTEGER, entries: 1 });
  budget.clearOwner('x'); expect(budget.snapshot().totalBytes).toBe(0);
});

test.each([false, true])('deterministic Map-LRU oracle matches accounting and eviction (extreme=%s)', extreme => {
  const budget = new DerivedCacheBudget(37);
  const reference = new Map<string, { owner: string; bytes: number; label: string; allow: boolean }>();
  const actualEvictions: string[] = [], expectedEvictions: string[] = [];
  const charges = extreme ? [0, 0.2, 8, 38, NaN, Infinity, -1, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER + 1] : [0, 0.2, 1, 3, 8, 15, 36, 38];
  let seed = 123456789;
  const next = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return seed >>> 0; };
  const total = () => [...reference.values()].reduce((sum, entry) => sum + BigInt(entry.bytes), 0n);
  for (let step = 0; step < 2000; step++) {
    const owner = `owner${next() % 4}`, key = `key${next() % 17}`, id = `${owner}/${key}`, operation = next() % 10;
    if (operation < 6) {
      const charge = charges[next() % charges.length]!, allow = next() % 4 === 0, label = `${step}:${id}`;
      budget.register(owner, key, charge, () => actualEvictions.push(label), { allowOversized: allow });
      reference.delete(id);
      const rounded = Number.isFinite(charge) && charge >= 0 ? Math.ceil(charge) : NaN;
      if (!Number.isSafeInteger(rounded)) expectedEvictions.push(label);
      else {
        reference.set(id, { owner, bytes: rounded, label, allow });
        while (total() > 37n && reference.size) {
          const [oldest, entry] = reference.entries().next().value!;
          if (reference.size === 1 && entry.allow) break;
          reference.delete(oldest); expectedEvictions.push(entry.label);
        }
      }
    } else if (operation < 8) {
      budget.touch(owner, key);
      const entry = reference.get(id); if (entry) { reference.delete(id); reference.set(id, entry); }
    } else if (operation === 8) { budget.remove(owner, key); reference.delete(id); }
    else {
      budget.clearOwner(owner);
      for (const [key, entry] of reference) if (entry.owner === owner) reference.delete(key);
    }
    expect(budget.snapshot(), `step ${step}`).toEqual({ maxBytes: 37, totalBytes: Number(total()), entries: reference.size });
    expect(actualEvictions, `evictions ${step}`).toEqual(expectedEvictions);
    actualEvictions.length = expectedEvictions.length = 0;
    const internals = budget as any;
    expect(internals.lruHeap.length).toBe(reference.size);
    expect([...internals.entriesByOwner.values()].reduce((sum: number, keys: any) => sum + keys.size, 0)).toBe(reference.size);
    for (let i = 0; i < internals.lruHeap.length; i++) expect(internals.entries.get(internals.lruHeap[i].id).heapIndex).toBe(i);
  }
});
