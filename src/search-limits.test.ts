import { describe, expect, test } from 'vitest';
import { boundItems, boundSearchResults, boundedTopK } from './search-limits.js';

describe('bounded response helpers', () => {
  test('preserve exact JSON array boundaries without reserializing the prefix', () => {
    const items = [{ text: '한글, "quoted"' }, { text: 'second' }, { text: 'third' }];
    const exactBudget = JSON.stringify(items.slice(0, 2)).length;

    expect(boundSearchResults(items, exactBudget)).toEqual(items.slice(0, 2));
    expect(boundItems(items, exactBudget)).toEqual({ items: items.slice(0, 2), truncated: true });
  });

  test('keeps an oversized first item for compatibility with existing bounds', () => {
    const item = { text: 'long item' };
    const budget = JSON.stringify([item]).length - 1;

    expect(boundSearchResults([item, { text: 'later' }], budget)).toEqual([item]);
    expect(boundItems([item, { text: 'later' }], budget)).toEqual({ items: [item], truncated: true });
  });
});

describe('boundedTopK', () => {
  test('keeps the best items without sorting the full input', () => {
    const result = boundedTopK(
      Array.from({ length: 10_000 }, (_, score) => ({ score, id: `item-${score}` })),
      3,
      (a, b) => b.score - a.score,
    );

    expect(result.map(item => item.score)).toEqual([9_999, 9_998, 9_997]);
  });
});
