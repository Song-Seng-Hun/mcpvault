import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { runNode } from './process.mjs';
import { vitestArguments } from './config.mjs';
import { sourceBasis, ensureRunDirectory, writeRecord, readRecord, acquireWorker, hash } from './manifest.mjs';
import { reportVerdict } from './report.mjs';
import { repositoryChanges, changedTestSelection } from './changed.mjs';

export async function readCoverage(dir, manifest, root) {
  const totals = { files: [], tests: 0, passed: 0, skipped: 0 }, seen = new Set();
  const names = await readdir(dir);
  assert(!names.some(n => /^batch-[1-9][0-9]*\.failed\.json$/.test(n)), 'Prior test failure requires inspection and a new run');
  for (const name of names.filter(n => /^batch-[1-9][0-9]*\.done\.json$/.test(n)).sort()) {
    const receipt = await readRecord(dir, name), prefix = name.slice(0, -10);
    assert(!names.includes(prefix + '.interrupted.json'), 'Conflicting interrupted receipt');
    const begin = await readRecord(dir, prefix + '.begin.json');
    assert(receipt.basis === manifest.basis && begin.basis === manifest.basis && receipt.stopped === false, 'Receipt basis differs');
    if (manifest.version >= 2) assert(receipt.scope === manifest.scope && receipt.base === manifest.base && receipt.selection?.join('\0') === manifest.files.join('\0'), 'Receipt selection differs');
    assert.deepEqual(receipt.files, begin.files, 'Receipt scope differs');
    for (const file of receipt.files) { assert(manifest.files.includes(file) && !seen.has(file), 'Duplicate or unexpected coverage'); seen.add(file); }
    const report = await readRecord(dir, prefix + '.report.json');
    assert.equal(hash(JSON.stringify(report)), receipt.reportHash, 'Report changed'); assert(report.startTime >= manifest.startedAt, 'Report predates run');
    const verdict = reportVerdict(report, root, receipt.files, receipt.code);
    for (const key of ['tests', 'passed', 'skipped']) totals[key] += verdict[key];
  }
  totals.files = [...seen].sort(); return totals;
}

export async function runSafeTests(root, options, signal, log = value => console.log(JSON.stringify(value))) {
  const release = await acquireWorker(root);
  try {
    const discovery = await runNode(root, ['--max-old-space-size=512', join(root, 'node_modules/vitest/vitest.mjs'), 'list', '--filesOnly', '--json'],
      { signal, captureLimit: 8 * 1024 * 1024, maxOutputBytes: 8 * 1024 * 1024, timeoutMs: 60000 });
    if (discovery.stopped) { log({ complete: false, reason: discovery.reason }); return 75; }
    assert.equal(discovery.code, 0, 'Vitest discovery failed');
    const list = JSON.parse(discovery.output); assert(Array.isArray(list) && list.length > 0, 'No test files discovered');
    const all = list.map(item => relative(root, item.file).replaceAll('\\', '/')).sort();
    let files = all, scope = 'full', base = null;
    if (options.changed) {
      const discoveryBasis = await sourceBasis(root, all);
      const changes = repositoryChanges(root, options.base), changed = changes.records;
      base = changes.baseSha;
      if (!changed.length) { log({ complete: false, scope: 'unchanged', base, testFiles: 0, tests: 0, passed: 0, skipped: 0 }); return 0; }
      const selected = await runNode(root, ['--max-old-space-size=512', join(root, 'node_modules/vitest/vitest.mjs'), 'list', '--changed', base, '--filesOnly', '--json'],
        { signal, captureLimit: 8 * 1024 * 1024, maxOutputBytes: 8 * 1024 * 1024, timeoutMs: 60000 });
      assert(!selected.stopped && selected.code === 0, 'Vitest changed discovery failed');
      const related = JSON.parse(selected.output).map(item => relative(root, item.file).replaceAll('\\', '/')).filter(f => all.includes(f));
      const decision = changedTestSelection({ changed, vitest: related, all });
      files = decision.files; scope = decision.fullRequired ? 'full-required' : 'changed';
      assert.equal(await sourceBasis(root, all), discoveryBasis, 'Source changed during test selection');
    }
    assert(new Set(files).size === files.length && files.every(f => /^(src|scripts)\/[a-zA-Z0-9_/.-]+\.test\.ts$/.test(f) && !f.split('/').includes('..')), 'Invalid or multi-project test inventory');
    const basis = await sourceBasis(root, files), dir = await ensureRunDirectory(root, options.runId, options.resume);
    const manifest = options.resume ? await readRecord(dir, 'manifest.json') : { version: 2, basis, files, startedAt: Date.now(), scope, base };
    assert([1, 2].includes(manifest.version) && manifest.basis === basis && Number.isFinite(manifest.startedAt), 'Source/build/runtime basis changed; start a new run');
    assert.deepEqual(manifest.files, files, 'Test inventory changed');
    if (manifest.version >= 2) { assert.equal(manifest.scope, scope); assert.equal(manifest.base, base); }
    if (!options.resume) await writeRecord(dir, 'manifest.json', manifest);
    log({ runId: options.runId, scope, base, phase: 'start', expectedTestFiles: files.length });
    for (let batches = 0; ; batches++) {
      assert.equal(await sourceBasis(root, files), basis, 'Source/build/runtime basis changed');
      const coverage = await readCoverage(dir, manifest, root), remaining = files.filter(f => !coverage.files.includes(f));
      if (!remaining.length) { log({ runId: options.runId, scope, base, complete: true, phase: 'end', testFiles: coverage.files.length,
        expectedTestFiles: files.length, tests: coverage.tests, passed: coverage.passed, skipped: coverage.skipped }); return 0; }
      if (signal?.aborted || batches >= options.maxBatches) { log({ runId: options.runId, scope, base, complete: false, reason: signal?.aborted ? 'cancelled' : 'batch_limit' }); return 75; }
      const names = await readdir(dir); let number = 1;
      while (names.some(n => n.startsWith(`batch-${number}.`))) number++;
      const prefix = `batch-${number}`, selected = remaining.slice(0, options.chunkSize);
      await writeRecord(dir, prefix + '.begin.json', { files: selected, basis });
      const result = await runNode(root, vitestArguments(root, selected, join(dir, prefix + '.report.json')), { signal });
      // A stopped process cannot leave an accepted receipt even if it emitted
      // a success-looking JSON report before its actual termination.
      if (result.stopped) {
        await writeRecord(dir, prefix + '.interrupted.json', { basis, scope, base, selection: files, code: result.code, reason: result.reason, minimumFreeGiB: result.minimumFreeGiB });
        log({ complete: false, reason: result.reason, runId: options.runId }); return 75;
      }
      assert.equal(await sourceBasis(root, files), basis, 'Source changed while tests ran');
      try {
        const report = await readRecord(dir, prefix + '.report.json');
        reportVerdict(report, root, selected, result.code);
        await writeRecord(dir, prefix + '.done.json', { basis, scope, base, selection: files, files: selected, code: result.code, stopped: false,
          reportHash: hash(JSON.stringify(report)), minimumFreeGiB: result.minimumFreeGiB });
      } catch {
        await writeRecord(dir, prefix + '.failed.json', { basis, code: result.code, output: result.output });
        log({ complete: false, reason: 'failed_or_incomplete_report', runId: options.runId, batch: number }); return 1;
      }
    }
  } finally { await release(); }
}
