import { expect, test } from 'vitest';
import { BacklinkOccurrenceCache } from './backlink-occurrence-cache.js';

test('complete scans retain duplicate occurrence identity; misses and empty hits stay distinct', () => {
  const cache = new BacklinkOccurrenceCache<object>();
  const occurrence = { line: 2 }; let calls = 0;
  const scan = () => { calls++; return [occurrence, occurrence]; };
  expect([...cache.read('a', scan)]).toEqual([occurrence, occurrence]);
  expect([...cache.read('a', scan)][0]).toBe(occurrence);
  expect(calls).toBe(1);
  const empty = () => { calls++; return []; };
  expect([...cache.read('empty', empty)]).toEqual([]);
  expect([...cache.read('empty', empty)]).toEqual([]);
  expect(calls).toBe(2);
});
test('early exit and exceptions never cache prefixes and release admission', () => {
  const cache = new BacklinkOccurrenceCache<number>(); let calls = 0;
  const scan = () => { calls++; return [1, 2, 3]; };
  for (const _ of cache.read('a', scan)) break;
  expect([...cache.read('a', scan)]).toEqual([1, 2, 3]);
  expect(calls).toBe(2);
  expect(() => [...cache.read('b', function* () { yield 9; throw Error('unavailable'); })]).toThrow('unavailable');
  expect([...cache.read('b', scan)]).toEqual([1, 2, 3]);
  expect([...cache.read('b', scan)]).toEqual([1, 2, 3]);
  expect(calls).toBe(3);
});
test('oversized targets stream in full without evicting useful completed entries', () => {
  const cache = new BacklinkOccurrenceCache<number>(2, 4, 2); let calls = 0;
  expect([...cache.read('small', () => [1, 2])]).toEqual([1, 2]);
  const large = () => { calls++; return [1, 2, 3]; };
  expect([...cache.read('large', large)]).toEqual([1, 2, 3]);
  expect([...cache.read('large', large)]).toEqual([1, 2, 3]);
  expect(calls).toBe(2);
  expect([...cache.read('small', () => { throw Error('should be cached'); })]).toEqual([1, 2]);
});
test('LRU enforces retained occurrence and empty-target bounds independently', () => {
  const cache = new BacklinkOccurrenceCache<number>(3, 4, 2);
  const fill = (key: string, values = [1, 2]) => [...cache.read(key, () => values)];
  fill('a'); fill('b'); fill('a'); fill('c');
  expect(fill('a', [9])).toEqual([1, 2]);
  expect(fill('b', [8])).toEqual([8]); // b evicted by edge budget
  fill('x', []); fill('y', []); fill('z', []);
  expect(fill('a', [9])).toEqual([9]); // even empty keys evict by target budget
});
test('overlapping misses do not allocate or publish another admission buffer', () => {
  const cache = new BacklinkOccurrenceCache<number>(); let calls = 0;
  const first = cache.read('a', () => [1, 2]);
  expect(first.next().value).toBe(1);
  const second = () => { calls++; return [3, 4]; };
  expect([...cache.read('b', second)]).toEqual([3, 4]);
  expect([...first]).toEqual([2]);
  expect([...cache.read('b', second)]).toEqual([3, 4]);
  expect([...cache.read('b', second)]).toEqual([3, 4]);
  expect(calls).toBe(2);
});
test.each([[0, 1, 1], [1, 0, 1], [1, 1, 2], [NaN, 1, 1], [1, 1.5, 1]])('invalid limits fail closed: %j', (targets, retained, fill) => {
  expect(() => new BacklinkOccurrenceCache(targets, retained, fill)).toThrow();
});
