import { expect, test, vi } from 'vitest';
import { DerivedCacheBudget, estimateCacheBytes } from './cache-budget.js';

test.each([
  null, false, 0, 1.5, '', '가😀\n\t"\\\ud800', [], {},
  { omitted: undefined, list: [undefined, NaN, Infinity], text: '위키' },
  new Date('2026-09-07T00:00:00Z'),
])('preserves the native JSON UTF-8 estimate for %j', value => {
  expect(estimateCacheBytes(value)).toBe(Buffer.byteLength(JSON.stringify(value), 'utf8'));
});

const cyclic: Record<string, unknown> = {};
cyclic.self = cyclic;
const badValues = [
  ['cycle', cyclic], ['BigInt', 1n], ['undefined', undefined],
  ['function', () => undefined], ['symbol', Symbol('value')],
  ['missing toJSON', { toJSON: () => undefined }],
  ['throwing toJSON', { toJSON: () => { throw new Error('private detail'); } }],
  ['throwing getter', { get value() { throw new Error('private detail'); } }],
] as const;

test.each(badValues)('%s is unmeasurable, never free', (_label, value) => {
  expect(estimateCacheBytes(value)).toBe(Infinity);
});

test('serialization happens once, including custom JSON representations', () => {
  const toJSON = vi.fn(() => ({ title: '위키' }));
  expect(estimateCacheBytes({ toJSON })).toBe(Buffer.byteLength('{"title":"위키"}', 'utf8'));
  expect(toJSON).toHaveBeenCalledTimes(1);
});

test.each([0, 64, 128])('unmeasurable estimates with %i overhead evict only the new cache', overhead => {
  const budget = new DerivedCacheBudget(1024);
  const valid = vi.fn(), rejected = vi.fn();
  budget.register('valid', 'row', 8, valid);
  budget.register('bad', 'row', estimateCacheBytes(cyclic) * 2 + overhead, rejected, { allowOversized: true });
  expect(rejected).toHaveBeenCalledTimes(1);
  expect(valid).not.toHaveBeenCalled();
  expect(budget.snapshot()).toEqual({ maxBytes: 1024, totalBytes: 8, entries: 1 });
});
