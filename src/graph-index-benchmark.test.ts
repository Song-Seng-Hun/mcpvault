import { expect, test } from 'vitest';
// @ts-expect-error Offline opt-in measurement, excluded from the server build.
import { benchmarkGraphIndex, parseBenchmarkArguments, sampleSummary } from '../scripts/benchmark-graph-index.mjs';

test('graph measurement arguments permit only explicit synthetic scales, never a caller vault', () => {
  expect(parseBenchmarkArguments([])).toEqual({ notes: 1000, samples: 8 });
  expect(parseBenchmarkArguments(['--notes', '10000'])).toEqual({ notes: 10000, samples: 8 });
  for (const args of [['--notes', '42'], ['--notes', '50001'], ['--vault', '//nas/private'], ['--notes', '1000', '--notes', '1000'], ['--samples', '0']]) {
    expect(() => parseBenchmarkArguments(args)).toThrow();
  }
});
test('graph measurements report nearest-rank quantiles and actual sample counts', () => {
  expect(sampleSummary([4, 1, 3, 2])).toEqual({ samples: 4, p50Ms: 2, p95Ms: 4 });
  expect(() => sampleSummary([])).toThrow();
  expect(() => sampleSummary([NaN])).toThrow();
});
test('graph fixture validates actual index mutation, alias drift and same-predicate permission revocation', async () => {
  const result = await benchmarkGraphIndex({ notes: 32, samples: 2 });
  expect(result).toMatchObject({ notes: 32, synthetic: true, canonicalVaultUsed: false, fixtureRemoved: true,
    correctness: { occurrenceKinds: true, revisionsChanged: true, deletion: true, aliasDrift: true, permissionRevocation: true },
    dense: { reverseCacheCap: 16384, exceedsCacheCap: false },
    smbBytes: null, alternativeDatabaseTested: false });
  expect(result.scenarios.map((s: any) => s.name)).toEqual(['cold_build', 'warm_query', 'upsert', 'delete', 'alias_add', 'alias_remove', 'permission_revoke', 'dense_build', 'dense_warm']);
  expect(result.scenarios[0].logicalReads.calls).toBeGreaterThanOrEqual(32);
  expect(result.scenarios[0].logicalReads.bytes).toBeGreaterThan(0);
  expect(result.scenarios.every((s: any) => s.latency.samples > 0 && s.latency.p95Ms >= s.latency.p50Ms)).toBe(true);
  expect(result.maxRssMiB).toBeGreaterThan(0);
}, 30000);
test('graph fixture refuses invalid scale or extra path options before generating files', async () => {
  await expect(benchmarkGraphIndex({ notes: 10, samples: 2 })).rejects.toThrow();
  await expect(benchmarkGraphIndex({ notes: 32, samples: 2, root: 'C:/private' })).rejects.toThrow();
});
