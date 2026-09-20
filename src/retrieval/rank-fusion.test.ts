import { test, expect } from 'vitest';
import { reciprocalRanks } from './rank-fusion.js';
test('equal-weight RRF keeps channel cap, unique ranks and agreement independent of confidence', () => {
  const r = reciprocalRanks([['a', 'b', 'b'], ['b', 'c']]);
  expect(r.get('b')).toBeCloseTo(1 / 62 + 1 / 61);
  expect(r.get('b')!).toBeGreaterThan(r.get('a')!);
  expect(reciprocalRanks([Array.from({ length: 25 }, (_, i) => String(i))]).has('20')).toBe(false);
});
