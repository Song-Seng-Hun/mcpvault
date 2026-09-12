import { expect, test } from 'vitest';
import { DerivedCacheBudget } from './cache-budget.js';

test('active work and retained derivatives share the same admission ceiling', () => {
  const budget = new DerivedCacheBudget(10), evicted: string[] = [];
  budget.register('cache', 'old', 8, () => evicted.push('old'));
  const work = (budget as any).reserveWork(7);
  expect(evicted).toEqual(['old']);
  expect((budget as any).workSnapshot()).toEqual({ maxBytes: 10, activeBytes: 7, totalBytes: 7 });
  expect(() => (budget as any).reserveWork(4)).toThrow(/memory|budget|busy/i);
  budget.register('cache', 'new', 8, () => evicted.push('new'));
  expect(evicted).toEqual(['old', 'new']);
  work.release(); work.release();
  expect((budget as any).workSnapshot().activeBytes).toBe(0);
});

test('work reservations never borrow an oversized advisory cache exception', () => {
  const budget = new DerivedCacheBudget(10), evicted: string[] = [];
  budget.register('cache', 'large', 20, () => evicted.push('large'), { allowOversized: true });
  const lease = (budget as any).reserveWork(1);
  expect(evicted).toEqual(['large']);
  expect((budget as any).workSnapshot().totalBytes).toBe(1);
  lease.release();
});

test('invalid and overflowing work charges fail without losing existing reservations', () => {
  const budget = new DerivedCacheBudget(10), lease = (budget as any).reserveWork(3);
  for (const bytes of [-1, NaN, Infinity, 0.5, Number.MAX_SAFE_INTEGER]) expect(() => (budget as any).reserveWork(bytes)).toThrow();
  expect((budget as any).workSnapshot().activeBytes).toBe(3);
  lease.release();
});

test('a reserve attempt inside an eviction callback sees already pinned work', () => {
  const budget = new DerivedCacheBudget(10);
  let denied = false;
  budget.register('cache', 'entry', 8, () => { try { (budget as any).reserveWork(4); } catch { denied = true; } });
  const lease = (budget as any).reserveWork(7);
  expect(denied).toBe(true);
  expect((budget as any).workSnapshot().activeBytes).toBe(7);
  lease.release();
});
