import { expect, test } from 'vitest';
import { DocumentTopK } from './document-ranking.js';

test('top-k retains only its window and exactly matches exhaustive stable ranking', () => {
  const compare = (a: { score: number; id: number }, b: { score: number; id: number }) => b.score - a.score || a.id - b.id;
  const ranking = new DocumentTopK(100, compare);
  const baseline = Array.from({ length: 10000 }, (_, id) => ({ id, score: (id * 7919) % 997 }));
  for (const row of baseline) { ranking.offer(row); expect(ranking.size).toBeLessThanOrEqual(100); }
  expect(ranking.sorted()).toEqual(baseline.sort(compare).slice(0, 100));
});

test('ties and ordered inputs retain deterministic window boundaries', () => {
  for (const input of [[1, 2, 3, 4], [4, 3, 2, 1], [2, 2, 2, 2]]) {
    const ranking = new DocumentTopK<number>(2, (a, b) => a - b);
    input.forEach(value => ranking.offer(value));
    expect(ranking.sorted()).toEqual(input.toSorted((a, b) => a - b).slice(0, 2));
  }
});
