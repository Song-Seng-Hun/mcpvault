import { expect, test } from 'vitest';
import { mkdtemp, writeFile, mkdir, rm, readFile, symlink, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// @ts-expect-error Host tooling, not a server runtime module.
import { parseOptions, vitestArguments } from '../scripts/testing/config.mjs';
// @ts-expect-error Host tooling, not a server runtime module.
import { reportVerdict } from '../scripts/testing/report.mjs';
// @ts-expect-error Host tooling, not a server runtime module.
import { sourceBasis, ensureRunDirectory, writeRecord, readRecord, acquireWorker } from '../scripts/testing/manifest.mjs';
// @ts-expect-error Host tooling, not a server runtime module.
import { runNode } from '../scripts/testing/process.mjs';
// @ts-expect-error Host tooling, not a server runtime module.
import { readCoverage, runSafeTests } from '../scripts/testing/runner.mjs';

test('safe runner defaults preserve isolation and bound coordinator/worker memory', () => {
  expect(parseOptions([])).toMatchObject({ chunkSize: 20, maxBatches: Infinity, resume: false });
  const args = vitestArguments('/repo', ['src/One.test.ts'], '/reports/one.json');
  expect(args).toContain('--max-old-space-size=512');
  expect(args).toContain('--maxWorkers=1'); expect(args).toContain('--execArgv=--max-old-space-size=512');
  expect(args.join(' ')).not.toMatch(/poolOptions|no-isolate|passWithNoTests|retry/);
});
test('bounded CLI refuses unknown flags, duplicate options, paths and unsafe run IDs', () => {
  expect(parseOptions(['--chunk-size=1', '--resume=run-one', '--max-batches=2'])).toMatchObject({ chunkSize: 1, runId: 'run-one', resume: true, maxBatches: 2 });
  for (const args of [['--chunk-size=21'], ['--chunk-size=0'], ['--chunk-size=2', '--chunk-size=2'], ['--run-id=../outside'],
    ['--run-id=a', '--resume=a'], ['--run-id=a=b'], ['--reserve=0'], ['--max-batches=NaN'], ['src/foo.test.ts']]) expect(() => parseOptions(args)).toThrow();
});
const root = process.cwd(), file = 'src/One.test.ts';
function report() { return { success: true, numTotalTests: 1, numFailedTests: 0, numFailedTestSuites: 0,
  snapshot: { failure: false }, testResults: [{ name: root + '/' + file, status: 'passed',
    assertionResults: [{ fullName: 'one passes', status: 'passed' }] }] }; }
test('report acceptance requires process success and exact actual assertion/file coverage', () => {
  expect(reportVerdict(report(), root, [file], 0)).toEqual({ tests: 1, passed: 1, skipped: 0 });
  expect(() => reportVerdict(report(), root, [file], 1)).toThrow();
  expect(() => reportVerdict(report(), root, ['src/Other.test.ts'], 0)).toThrow();
  for (const field of ['numFailedTests', 'numFailedTestSuites', 'numRuntimeErrorTestSuites', 'numTotalTests']) {
    const r: any = report(); r[field] = 2; expect(() => reportVerdict(r, root, [file], 0)).toThrow();
  }
  const duplicate = report(); duplicate.testResults.push(duplicate.testResults[0]!);
  expect(() => reportVerdict(duplicate, root, [file], 0)).toThrow();
});
test.each(['failed', 'pending', 'todo', 'skipped'])('unexpected %s assertions cannot count as successful coverage', status => {
  const r = report(); r.testResults[0]!.assertionResults[0]!.status = status;
  expect(() => reportVerdict(r, root, [file], 0)).toThrow();
});
test('source basis detects test, build and configuration drift but ignores runtime results', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'safe-runner-basis-'));
  try {
    for (const sub of ['src', 'tests', 'scripts', 'dist', 'node_modules/vitest']) await mkdir(join(dir, sub), { recursive: true });
    for (const name of ['package.json', 'package-lock.json', 'vitest.config.ts', 'tsconfig.json', 'tsconfig.build.json']) await writeFile(join(dir, name), '{}');
    await writeFile(join(dir, 'node_modules/vitest/package.json'), '{"version":"4.1.10"}');
    await writeFile(join(dir, 'src/One.test.ts'), 'first');
    const a = await sourceBasis(dir, ['src/One.test.ts']);
    await mkdir(join(dir, '.mcpvault')); await writeFile(join(dir, '.mcpvault/report.json'), 'ignored');
    expect(await sourceBasis(dir, ['src/One.test.ts'])).toBe(a);
    await writeFile(join(dir, 'src/One.test.ts'), 'changed'); expect(await sourceBasis(dir, ['src/One.test.ts'])).not.toBe(a);
    const b = await sourceBasis(dir, ['src/One.test.ts']); await writeFile(join(dir, 'dist/a.js'), 'changed');
    expect(await sourceBasis(dir, ['src/One.test.ts'])).not.toBe(b);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test('checkpoint paths and single-worker ownership never overwrite existing or damaged records', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'safe-runner-state-'));
  try {
    const state = await ensureRunDirectory(dir, 'one', false);
    await writeRecord(state, 'manifest.json', { basis: 'pinned' });
    expect(await readRecord(state, 'manifest.json')).toEqual({ basis: 'pinned' });
    await expect(writeRecord(state, 'manifest.json', {})).rejects.toThrow();
    await expect(ensureRunDirectory(dir, 'one', false)).rejects.toThrow();
    await expect(ensureRunDirectory(dir, '../outside', false)).rejects.toThrow();
    const release = await acquireWorker(dir);
    await expect(acquireWorker(dir)).rejects.toThrow(); await release();
    const again = await acquireWorker(dir); await again();
    await writeFile(join(state, 'broken.json'), '{'); await expect(readRecord(state, 'broken.json')).rejects.toThrow();
    expect(await readFile(join(state, 'broken.json'), 'utf8')).toBe('{');
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test('process guard observes actual exit and cancels only its owned child', async () => {
  const success = await runNode(root, ['-e', 'process.stdout.write("ok")']);
  expect(success).toMatchObject({ code: 0, stopped: false, output: 'ok' });
  const controller = new AbortController();
  const cancelled = await runNode(root, ['-e', 'console.log("ready");setInterval(()=>{},1000)'], {
    signal: controller.signal, onOutput: () => controller.abort() });
  expect(cancelled.stopped).toBe(true); expect(cancelled.reason).toBe('cancelled');
});
test('memory admission and mid-process reserve cannot produce passing results', async () => {
  expect(await runNode(root, ['-e', 'throw Error("must not start")'], { availableMemory: () => 1 })).toMatchObject({ started: false, stopped: true, reason: 'memory' });
  let memory = 5;
  const result = await runNode(root, ['-e', 'console.log("ready");setInterval(()=>{},1000)'], { availableMemory: () => memory, onOutput: () => { memory = 1; } });
  expect(result).toMatchObject({ started: true, stopped: true, reason: 'memory' });
});
test('resume accepts only matching completed receipts, not interrupted, duplicate or changed reports', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'safe-runner-resume-'));
  try {
    const state = await ensureRunDirectory(dir, 'one', false), manifest = { version: 1, basis: 'a'.repeat(64), files: [file], startedAt: 1 };
    await writeRecord(state, 'batch-1.begin.json', { files: [file], basis: manifest.basis });
    expect(await readCoverage(state, manifest, root)).toMatchObject({ files: [], passed: 0 });
    const r: any = report(); r.startTime = 2;
    await writeRecord(state, 'batch-1.report.json', r);
    expect(await readCoverage(state, manifest, root)).toMatchObject({ files: [], passed: 0 });
    const { createHash } = await import('node:crypto');
    const receipt = { basis: manifest.basis, files: [file], code: 0, stopped: false, reportHash: createHash('sha256').update(JSON.stringify(r)).digest('hex') };
    await writeRecord(state, 'batch-1.done.json', receipt);
    expect(await readCoverage(state, manifest, root)).toMatchObject({ files: [file], tests: 1, passed: 1, skipped: 0 });
    await expect(readCoverage(state, { ...manifest, basis: 'b'.repeat(64) }, root)).rejects.toThrow();
    await writeRecord(state, 'batch-2.begin.json', { files: [file], basis: manifest.basis });
    await writeRecord(state, 'batch-2.report.json', r);
    await writeRecord(state, 'batch-2.done.json', receipt);
    await expect(readCoverage(state, manifest, root)).rejects.toThrow(/Duplicate/);
    await unlink(join(state, 'batch-2.done.json'));
    await writeRecord(state, 'batch-1.interrupted.json', { reason: 'cancelled' });
    await expect(readCoverage(state, manifest, root)).rejects.toThrow(/interrupted/);
    await unlink(join(state, 'batch-1.interrupted.json'));
    await writeFile(join(state, 'batch-1.report.json'), JSON.stringify({ ...r, success: false }));
    await expect(readCoverage(state, manifest, root)).rejects.toThrow();
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test('real Vitest batches resume once and complete without replay; changed inputs reject old receipts', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'safe-runner-e2e-')); let linked = false;
  try {
    await mkdir(join(dir, 'src')); await symlink(join(root, 'node_modules'), join(dir, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir'); linked = true;
    for (const name of ['package-lock.json', 'tsconfig.json', 'tsconfig.build.json']) await writeFile(join(dir, name), '{}');
    await writeFile(join(dir, 'package.json'), '{"type":"module"}');
    await writeFile(join(dir, 'vitest.config.ts'), 'export default {test:{include:["src/*.test.ts"]}}');
    for (const id of ['A', 'B']) await writeFile(join(dir, `src/${id}.test.ts`),
      `import {test,expect} from 'vitest';import {appendFile} from 'node:fs/promises';test('${id}',async()=>{await appendFile('.mcpvault/seen','${id}');expect(1).toBe(1)});`);
    const messages: any[] = [], log = (value: any) => messages.push(value);
    expect(await runSafeTests(dir, parseOptions(['--run-id=e2e', '--chunk-size=1', '--max-batches=1']), undefined, log)).toBe(75);
    expect(await readFile(join(dir, '.mcpvault/seen'), 'utf8')).toBe('A');
    expect(await runSafeTests(dir, parseOptions(['--resume=e2e', '--chunk-size=1']), undefined, log)).toBe(0);
    expect(messages.at(-1)).toMatchObject({ complete: true, testFiles: 2, tests: 2, passed: 2, skipped: 0 });
    expect(await runSafeTests(dir, parseOptions(['--resume=e2e']), undefined, log)).toBe(0);
    expect(await readFile(join(dir, '.mcpvault/seen'), 'utf8')).toBe('AB');
    await writeFile(join(dir, 'src/Extra.ts'), 'changed');
    await expect(runSafeTests(dir, parseOptions(['--resume=e2e']), undefined, log)).rejects.toThrow(/basis changed/);
  } finally { if (linked) await unlink(join(dir, 'node_modules')); await rm(dir, { recursive: true, force: true }); }
}, 30000);
