import { parentPort, workerData } from 'node:worker_threads';
import fs from 'node:fs';
import { compileRules } from './detect.mjs';
import { hash, failure } from './contract.mjs';
import { scan } from './scanner.mjs';
try {
  const { root, budget, rulesPath, expectedRulesHash } = workerData;
  let rules = [], rulesHash = null;
  if (rulesPath) {
    const st = fs.lstatSync(rulesPath);
    if (!st.isFile() || st.isSymbolicLink() || st.size > 1048576 || !/^[a-f0-9]{64}$/.test(expectedRulesHash || '')) throw Error('RULES_INVALID');
    let fd, raw;
    try {
      fd = fs.openSync(rulesPath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
      const before = fs.fstatSync(fd);
      if (!before.isFile() || before.ino !== st.ino || before.dev !== st.dev || before.size !== st.size) throw Error('RULES_CHANGED');
      const bytes = Buffer.alloc(st.size + 1); let read = 0, n;
      while (read < bytes.length && (n = fs.readSync(fd, bytes, read, bytes.length-read, read))) read += n;
      const after = fs.fstatSync(fd);
      if (read !== st.size || after.size !== st.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs) throw Error('RULES_CHANGED');
      raw = bytes.subarray(0, read);
    } finally { if (fd !== undefined) fs.closeSync(fd); }
    if (raw.length > 1048576 || hash(raw) !== expectedRulesHash) throw Error('RULES_CHANGED');
    rules = compileRules(JSON.parse(raw.toString('utf8'))); rulesHash = hash(raw);
  }
  parentPort.postMessage(scan(root, budget, rules, rulesHash));
} catch { parentPort.postMessage(failure('ERROR', 'RULES_OR_WORKER_ERROR')); }
