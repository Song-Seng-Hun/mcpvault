import { describe, expect, test } from 'vitest';
import { boundedTopK } from './search-limits.js';

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
