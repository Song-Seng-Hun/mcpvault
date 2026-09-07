import { expect, test } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);
const script = fileURLToPath(new URL('../scripts/benchmark-shared-http.mjs', import.meta.url));

test('shared HTTP benchmark rejects arbitrary paths/workloads before running', async () => {
  const result = await run(process.execPath, [script, '--vault=not-allowed'], { windowsHide: true })
    .then(value => ({ code: 0, ...value }), error => error);
  expect(result.code).not.toBe(0);
  expect(result.stderr).toContain('Use no arguments or --smoke');
});

test.skipIf(process.platform !== 'win32')('shared HTTP smoke measures equal work and reaps its disposable owners', async () => {
  const { stdout } = await run(process.execPath, [script, '--smoke'], {
    windowsHide: true, timeout: 60000, maxBuffer: 65536,
  });
  const report = JSON.parse(stdout);
  expect(report.config).toMatchObject({ clients: 1, notes: 16, rounds: 4 });
  expect(report.results.map((r: any) => r.mode)).toEqual(['stdio', 'http']);
  for (const result of report.results) {
    expect(result.serverCount).toBe(1);
    expect(result.requestCount).toBe(4);
    expect(result.cleanupVerified).toBe(true);
    expect(result.latencyMs.count).toBe(4);
    expect(result.readLatencyMs.count).toBe(2);
    expect(result.searchLatencyMs.count).toBe(2);
    expect(result.latencyMs.p95).toBeGreaterThanOrEqual(result.latencyMs.median);
    for (const key of ['startupMs', 'warmupMs', 'workloadMs', 'serverCpuMs']) {
      expect(Number.isFinite(result[key])).toBe(true);
      expect(result[key]).toBeGreaterThanOrEqual(0);
    }
    for (const phase of ['before', 'after']) {
      expect(result.memoryMiB[phase].workingSet).toBeGreaterThan(0);
      expect(result.memoryMiB[phase].privateBytes).toBeGreaterThan(0);
    }
  }
}, 65000);

test.skipIf(process.platform !== 'win32')('a failed stdio handshake still tracks and reaps the started owner', async () => {
  const { stdout } = await run(process.execPath, [script, '--smoke-fail-startup'], {
    windowsHide: true, timeout: 30000, maxBuffer: 65536,
  });
  expect(JSON.parse(stdout)).toEqual({ expectedStartupFailure: true, trackedOwners: 1, cleanupVerified: true });
}, 35000);
