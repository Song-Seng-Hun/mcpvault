import { expect, test } from 'vitest';
// @ts-expect-error Offline synthetic measurement, not part of the server build.
import { benchmarkBacklinkCache } from '../scripts/benchmark-backlink-cache.mjs';

test('distributed benchmark checks actual occurrence counts, revisions and cleanup', async () => {
  const result = await benchmarkBacklinkCache({ notes: 32, samples: 2 });
  expect(result).toMatchObject({ notes: 32, targets: 16, resolvedOccurrences: 320, synthetic: true,
    canonicalVaultUsed: false, sharedCatalog: true, correctness: true, fixtureRemoved: true });
  expect(result.scenarios.map((s: any) => s.name)).toEqual(['cold_build', 'hot_target', 'rotating_fill', 'rotating_hits']);
  // Initial catalog events can invalidate a read batch during the cold build.
  // Count that real IO; one read per file is not a freshness contract.
  expect(result.scenarios[0].logicalBodyReads).toBeGreaterThanOrEqual(32);
  expect(result.scenarios.slice(1).every((s: any) => s.logicalBodyReads === 0)).toBe(true);
}, 30000);

test.each([0, 31, 10001, NaN])('benchmark refuses unsafe scale %s', async notes => {
  await expect(benchmarkBacklinkCache({ notes })).rejects.toThrow('Invalid synthetic scale');
});
