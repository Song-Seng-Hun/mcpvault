import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';

// Dynamic import makes the initial RED an explicit missing-feature assertion.
let harness;
try { harness = await import('../scripts/benchmark-preservation-search.mjs'); }
catch (error) { if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error; }

test('benchmark requires explicit synthetic size and rejects paths, URLs and worker entry', () => {
  assert.ok(harness, 'synthetic benchmark harness must exist');
  assert.deepEqual(harness.parseArgs(['--smoke']), { size: 100, smoke: true });
  for (const size of [100, 1000, 10000]) {
    assert.deepEqual(harness.parseArgs(['--size', String(size)]), { size, smoke: false });
  }
  for (const args of [[], ['--size', '101'], ['--size', '1e3'], ['--smoke', '--size', '100'],
    ['E:\\dev\\llm_wiki'], ['https://example.com'], ['--worker'], ['--vault', '/tmp']]) {
    assert.throws(() => harness.parseArgs(args), /explicit|synthetic|arguments/i);
  }
});

test('quality gate rejects stale revisions, wrong locators, missing answers and ACL leakage', () => {
  assert.ok(harness, 'correctness gate must exist');
  const raw = 'needle source=src1 answer=answer1\n';
  const expected = [{ path: 'public/a.md', raw, source: 'src1', answer: 'answer1' }];
  const evidence = [{ path: 'public/a.md', revision: harness.sha256(raw),
    parts: [{ text: raw, startOffset: 0, endOffset: raw.length }] }];
  assert.equal(harness.gradeEvidence(expected, evidence, ['public/a.md']).pass, true);
  assert.equal(harness.gradeEvidence(expected, [], []).pass, false);
  assert.equal(harness.gradeEvidence(expected, [{ ...evidence[0], revision: '0'.repeat(64) }], []).pass, false);
  assert.equal(harness.gradeEvidence(expected, [{ ...evidence[0], parts: [{ text: raw, startOffset: 1, endOffset: raw.length }] }], []).pass, false);
  assert.equal(harness.gradeEvidence(expected, evidence, ['_scopes/users/other/secret.md']).pass, false);
  assert.equal(harness.gradeEvidence([], [], []).pass, true);
  assert.equal(harness.gradeEvidence(expected, [...evidence, evidence[0]], []).pass, false);
  assert.equal(harness.gradeEvidence(expected, evidence, ['public/a.md'], 'snippet lookup00000 source=src00000').pass, false);
  const wrong = [{ ...expected[0], answer: 'different-answer' }];
  assert.equal(harness.gradeEvidence(wrong, evidence, []).pass, false);
});

test('SPEC2 rejects private fixture paths anywhere in returned JSON, without answer markers', () => {
  const paths = [
    '_scopes/users/other/note-00000.md',
    String.raw`_scopes\users\other\note-00000.md`,
    '/_scopes/users/other/note-00010.md',
    'scope://user/other/note-00000.md',
    String.raw`scope://user\other\note-00010.md`,
    'SCOPE://USER/OTHER/note-00000.md',
  ];
  for (const path of paths) {
    for (const payload of [{ snippet: path }, { nested: [{ description: `See ${path} for details.` }] }, { [path]: 'metadata' }]) {
      const quality = harness.gradeEvidence([], [], [], JSON.stringify(payload));
      assert.equal(quality.pass, false, `private path accepted: ${JSON.stringify(payload)}`);
      assert.equal(quality.aclLeak, true);
    }
  }
  assert.equal(harness.gradeEvidence([], [], [], JSON.stringify({ snippet: 'public/note-00001.md' })).pass, true);
});

// Serial boundary tests intercept every fs.promises operation. They cannot
// contact the synthetic network paths even while exercising the buggy code.
for (const rawTemp of [
  String.raw`\\172.30.1.24\share\Temp`, '//synthetic-server/share/Temp',
  String.raw`\\?\UNC\synthetic-server\share\Temp`, String.raw`\\?\C:\Temp`,
  String.raw`\\.\C:\Temp`, String.raw`\??\C:\Temp`,
]) {
  test(`SPEC2 rejects raw UNC/device temp before ANY filesystem access: ${rawTemp}`, async () => {
    const originalFs = new Map(Object.entries(fs).filter(([, value]) => typeof value === 'function'));
    const originalTmpdir = os.tmpdir, originalFreemem = os.freemem;
    const originalSpawn = childProcess.spawn;
    const calls = []; let failure;
    try {
      for (const [name] of originalFs) fs[name] = async () => { calls.push(name); throw new Error('UNEXPECTED_FS_CALL'); };
      os.tmpdir = () => rawTemp;
      os.freemem = () => 8 * 2 ** 30;
      childProcess.spawn = () => { calls.push('spawn'); throw new Error('UNEXPECTED_SUBPROCESS'); };
      syncBuiltinESMExports();
      try { await harness.runBenchmark({ size: 100, smoke: true }); }
      catch (error) { failure = error; }
    } finally {
      for (const [name, fn] of originalFs) fs[name] = fn;
      os.tmpdir = originalTmpdir; os.freemem = originalFreemem;
      childProcess.spawn = originalSpawn;
      syncBuiltinESMExports();
    }
    assert.deepEqual(calls, [], 'lexically forbidden temp must be rejected before filesystem access');
    assert.match(String(failure), /local|UNC|device|temporary|temp path/i);
  });
}

test('SPEC2 Windows drive classifier admits only local fixed drives', () => {
  assert.equal(typeof harness.isLocalFixedDrive, 'function', 'runtime drive admission helper is missing');
  assert.equal(harness.isLocalFixedDrive('Fixed'), true);
  for (const type of ['Network', 'Removable', 'CDRom', 'Ram', 'Unknown', 'NoRootDirectory', '', undefined, 3]) {
    assert.equal(harness.isLocalFixedDrive(type), false, `drive type admitted: ${String(type)}`);
  }
});

test('behavioral smoke uses distinct real processes, freshness gates and measured IO', {
  skip: process.env.PRESERVATION_BENCHMARK_SMOKE !== '1',
}, async () => {
  assert.ok(harness);
  const result = await harness.runBenchmark({ size: 100, smoke: true });
  assert.equal(result.pass, true);
  assert.equal(result.results.length, 2);
  assert.notEqual(result.results[0].pid, result.results[1].pid);
  for (const arm of result.results) {
    assert.equal(arm.staleReadProbe.rejected, true);
    assert.ok(arm.processMaxRssBytes > 0);
    assert.ok(arm.initializationProbe.io.sourceReadBytes > 0);
    for (const stage of ['cold', 'warm', 'incremental']) {
      assert.equal(arm[stage].length, 6);
      assert.ok(arm[stage].every(q => q.quality.pass));
    }
  }
  // Compact evidence is useful when this opt-in test is run by the parent.
  console.log(JSON.stringify({ corpus: result.corpus, pass: result.pass, arms: result.results.map(arm => ({
    arm: arm.arm, startupMs: arm.startup.elapsedMs, initMs: arm.initializationProbe.elapsedMs,
    initBytes: arm.initializationProbe.io.sourceReadBytes, maintenanceMs: arm.incrementalMaintenanceProbe.elapsedMs,
    maintenanceBytes: arm.incrementalMaintenanceProbe.io.sourceReadBytes,
    maxRssBytes: arm.processMaxRssBytes, freeMinimumBytes: arm.supervisorFreeMemory.minimumBytes,
    coldMs: arm.cold.reduce((n, q) => n + q.elapsedMs, 0), warmMs: arm.warm.reduce((n, q) => n + q.elapsedMs, 0),
    coldBytes: arm.cold.reduce((n, q) => n + q.io.sourceReadBytes, 0),
    warmBytes: arm.warm.reduce((n, q) => n + q.io.sourceReadBytes, 0),
    staleRejected: arm.staleReadProbe.rejected,
  })) }));
});

test('report never converts characters or local bytes to model tokens or NAS measurements', () => {
  assert.ok(harness, 'honest metric helper must exist');
  const metrics = harness.unavailableMetrics();
  for (const key of ['model', 'modelInputTokens', 'modelOutputTokens', 'actualNasReadBytes', 'modelAnswerQuality']) {
    assert.equal(metrics[key], null, key);
  }
  assert.equal(metrics.measurementStatus, 'not-measured');
});

test('cleanup confinement rejects roots, siblings, prefix spoofing and traversal', () => {
  assert.ok(harness, 'cleanup confinement must exist');
  const base = process.platform === 'win32' ? 'C:\\Temp' : '/tmp';
  const owned = harness.fixturePath(base, 'abcdef');
  assert.equal(harness.isOwnedFixture(base, owned, owned), true);
  for (const path of [base, `${owned}-sibling`, `${owned}/../other`, '/', 'https://example.com']) {
    assert.equal(harness.isOwnedFixture(base, owned, path), false);
  }
});
