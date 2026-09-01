import { describe, expect, test } from 'vitest';
import { DerivedCacheBudget } from './cache-budget.js';

describe('DerivedCacheBudget', () => {
  test('evicts the least recently used disposable entry', () => {
    const budget = new DerivedCacheBudget(10);
    const evicted: string[] = [];

    budget.register('search', 'old', 6, () => evicted.push('old'));
    budget.register('search', 'new', 4, () => evicted.push('new'));
    budget.touch('search', 'new');
    budget.register('notifications', 'candidate', 4, () => evicted.push('candidate'));

    expect(evicted).toEqual(['old']);
    expect(budget.snapshot()).toEqual({ maxBytes: 10, totalBytes: 8, entries: 2 });
  });

  test('removes an owner without affecting another cache owner', () => {
    const budget = new DerivedCacheBudget(100);
    const evicted: string[] = [];

    budget.register('first', 'one', 10, () => evicted.push('one'));
    budget.register('second', 'two', 10, () => evicted.push('two'));
    budget.clearOwner('first');

    expect(evicted).toEqual([]);
    expect(budget.snapshot()).toEqual({ maxBytes: 100, totalBytes: 10, entries: 1 });
    budget.remove('second', 'two');
    expect(budget.snapshot()).toEqual({ maxBytes: 100, totalBytes: 0, entries: 0 });
  });

  test('does not retain an entry larger than the whole budget', () => {
    const budget = new DerivedCacheBudget(10);
    let evictions = 0;
    budget.register('search', 'huge', 11, () => { evictions += 1; });

    expect(evictions).toBe(1);
    expect(budget.snapshot()).toEqual({ maxBytes: 10, totalBytes: 0, entries: 0 });
  });

  test('can keep one bounded oversized snapshot without cache thrashing', () => {
    const budget = new DerivedCacheBudget(10);
    budget.register('public', 'snapshot', 11, () => { throw new Error('must stay resident'); }, { allowOversized: true });

    expect(budget.snapshot()).toEqual({ maxBytes: 10, totalBytes: 11, entries: 1 });
  });
});
