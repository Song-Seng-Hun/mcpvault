import assert from 'node:assert/strict';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

export function parseOptions(args) {
  const result = { chunkSize: 20, maxBatches: Infinity, resume: false, runId: randomUUID() }, seen = new Set();
  for (let i = 0; i < args.length; i++) {
    const parts = args[i].split('='); assert(parts.length <= 2, 'Malformed option');
    const [key, inline] = parts;
    assert(['--chunk-size', '--max-batches', '--run-id', '--resume'].includes(key) && !seen.has(key), 'Unknown or duplicate safe-test option');
    seen.add(key); const value = inline ?? args[++i]; assert(typeof value === 'string' && !value.includes('='), 'Option needs a value');
    if (key === '--run-id' || key === '--resume') {
      assert(/^[a-z0-9][a-z0-9-]{0,63}$/.test(value) && !(seen.has('--run-id') && seen.has('--resume')), 'Invalid run identity');
      result.runId = value; result.resume = key === '--resume';
    } else {
      assert(/^[1-9][0-9]*$/.test(value), 'Expected positive bounded integer'); const n = Number(value);
      assert(Number.isSafeInteger(n) && n <= (key === '--chunk-size' ? 20 : 10000), 'Option exceeds bound');
      result[key === '--chunk-size' ? 'chunkSize' : 'maxBatches'] = n;
    }
  }
  return result;
}
export function vitestArguments(root, files, output) {
  assert(files.length > 0 && files.length <= 20 && new Set(files).size === files.length, 'Invalid batch');
  for (const file of files) assert(/^(src|scripts)\/[a-zA-Z0-9_/.-]+\.test\.ts$/.test(file) && !file.split('/').includes('..'), 'Invalid test path');
  return ['--max-old-space-size=512', join(root, 'node_modules/vitest/vitest.mjs'), 'run', ...files,
    '--maxWorkers=1', '--execArgv=--max-old-space-size=512', '--reporter=verbose', '--reporter=json', `--outputFile.json=${output}`];
}
