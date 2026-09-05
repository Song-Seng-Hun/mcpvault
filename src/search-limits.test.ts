import { describe, expect, test } from 'vitest';
import { boundItems, boundSearchResults, boundedTopK, createBoundedTopK } from './search-limits.js';

describe('bounded response helpers', () => {
  test('preserve exact JSON array boundaries without reserializing the prefix', () => {
    const items = [{ text: '한글, "quoted"' }, { text: 'second' }, { text: 'third' }];
    const exactBudget = JSON.stringify(items.slice(0, 2)).length;

    expect(boundSearchResults(items, exactBudget)).toEqual(items.slice(0, 2));
    expect(boundItems(items, exactBudget)).toEqual({ items: items.slice(0, 2), truncated: true });
  });

  test('does not return an oversized first item', () => {
    const item = { text: 'long item' };
    const budget = JSON.stringify([item]).length - 1;

    expect(boundSearchResults([item, { text: 'later' }], budget)).toEqual([]);
    expect(boundItems([item, { text: 'later' }], budget)).toEqual({ items: [], truncated: true });
  });
});

describe('boundedTopK', () => {
  test('incremental selection retains at most K items and snapshots do not corrupt later additions', () => {
    const compare = (a: { score: number; id: number }, b: { score: number; id: number }) => b.score - a.score || a.id - b.id;
    const collector = createBoundedTopK(7, compare);
    const all: Array<{ score: number; id: number }> = [];
    for (let id = 0; id < 10000; id++) {
      const item = { id, score: (id * 7919) % 103 };
      all.push(item); collector.add(item);
      expect(collector.size).toBeLessThanOrEqual(7);
      if (id % 1000 === 0) {
        const snapshot = collector.values();
        expect(snapshot).toEqual([...all].sort(compare).slice(0, 7));
        snapshot.length = 0;
      }
    }
    expect(collector.values()).toEqual(all.sort(compare).slice(0, 7));
  });

  test.each([0, -1, 1.5, NaN, Infinity])('incremental selection rejects invalid capacity %s', limit => {
    expect(() => createBoundedTopK(limit, (a: number, b: number) => a - b)).toThrow(/positive integer/);
  });

  test('keeps the best items without sorting the full input', () => {
    const result = boundedTopK(
      Array.from({ length: 10_000 }, (_, score) => ({ score, id: `item-${score}` })),
      3,
      (a, b) => b.score - a.score,
    );

    expect(result.map(item => item.score)).toEqual([9_999, 9_998, 9_997]);
  });
});
