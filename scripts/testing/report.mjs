import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join, relative } from 'node:path';

export function allowedSkip(root, file, item) {
  if (process.platform === 'win32') {
    if (file === 'src/filesystem.test.ts' && item.fullName.endsWith('path with pipe character works')) return true;
    if (file === 'src/portable-setup.test.ts' && item.fullName.endsWith('doctor reports broad POSIX private permissions without repairing them')) return true;
    if (file === 'src/streaming-revision.test.ts' && item.status === 'skipped'
      && item.fullName === 'revision reads preserve inside-link support and outside-link rejection') return true;
    if (file === 'src/maintenance-host.test.ts' && item.status === 'skipped'
      && item.fullName === 'state symlinks are rejected for reads and commits without altering their target') return true;
  }
  if (file === 'src/workshop-model-evaluation.test.ts') for (const arm of ['free', 'managed']) {
    if (item.fullName === `recorded ${arm} model proposals replay through real workshop services`
      && !existsSync(join(root, `docs/research/workshop-evaluation-${arm}.json`))) return true;
  }
  return false;
}
export function reportVerdict(report, root, expected, code) {
  assert(code === 0 && report.success === true && report.numFailedTests === 0 && report.numFailedTestSuites === 0
    && (report.numRuntimeErrorTestSuites === undefined || report.numRuntimeErrorTestSuites === 0) && !report.snapshot?.failure, 'Failed process or report');
  assert(Array.isArray(report.testResults) && report.testResults.length > 0, 'Empty report');
  const actual = report.testResults.map(f => relative(root, f.name).replaceAll('\\', '/')).sort();
  assert.deepEqual(actual, [...expected].sort(), 'Report coverage differs'); assert.equal(new Set(actual).size, actual.length, 'Duplicate files');
  const totals = { tests: 0, passed: 0, skipped: 0 };
  for (const file of report.testResults) {
    assert(['passed', 'pending'].includes(file.status) && Array.isArray(file.assertionResults) && file.assertionResults.length > 0, 'Incomplete file');
    for (const item of file.assertionResults) {
      totals.tests++;
      if (item.status === 'passed') totals.passed++;
      else { assert(['pending', 'skipped'].includes(item.status) && allowedSkip(root, relative(root, file.name).replaceAll('\\', '/'), item), 'Unexpected incomplete assertion'); totals.skipped++; }
    }
  }
  assert.equal(totals.tests, report.numTotalTests, 'Assertion count differs');
  return totals;
}
