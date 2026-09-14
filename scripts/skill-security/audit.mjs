import { Worker } from 'node:worker_threads';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hash, failure, limits } from './contract.mjs';
const directory = path.dirname(fileURLToPath(import.meta.url));
const modules = ['audit.mjs','worker.mjs','scanner.mjs','detect.mjs','contract.mjs'];
// Retained legacy patterns are data, never imported code. A changed set requires review.
const RETAINED_RULES_HASH = 'e3768de982df1a576274c3831ade5b4402e3003bd4a5a1a3a20f9976d64f6f47';
let inFlight = false;
function engineHash() { return hash(modules.map(name => hash(fs.readFileSync(path.join(directory, name)))).join(':')); }

// Intentionally async: the parent can interrupt regex work; target code is never imported.
export async function auditSkillDirectory(targetDir, options = {}) {
  let budget, basis;
  try {
    budget = limits(options); basis = engineHash();
    if (options.autoEvolve || typeof targetDir !== 'string' || !path.isAbsolute(targetDir)) throw Error('INVALID_REQUEST');
  } catch { return failure('ERROR', 'INVALID_REQUEST_OR_ENGINE'); }
  const root = path.resolve(targetDir);
  const retained = path.join(directory, 'rules.json');
  const rulesPath = options.rulesPath ?? (fs.existsSync(retained) ? retained : undefined);
  const expectedRulesHash = options.rulesPath ? options.expectedRulesHash : rulesPath ? RETAINED_RULES_HASH : undefined;
  if (inFlight) return failure('ERROR', 'WORKER_BUSY');
  inFlight = true;
  return new Promise(resolve => {
    let worker, timer, settled = false;
    const finish = async report => {
      if (settled) return; settled = true; clearTimeout(timer);
      if (worker) await worker.terminate().catch(() => {});
      try { if (basis !== engineHash()) report = failure('ERROR', 'ENGINE_CHANGED'); }
      catch { report = failure('ERROR', 'ENGINE_CHANGED'); }
      inFlight = false;
      resolve({ ...report, engineHash: basis, budget, completedAt: new Date().toISOString() });
    };
    timer = setTimeout(() => void finish(failure('INCOMPLETE', 'WORKER_TIMEOUT')), budget.timeoutMs);
    try {
      worker = new Worker(new URL('./worker.mjs', import.meta.url), {
        workerData: { root, budget, rulesPath, expectedRulesHash },
        resourceLimits: { maxOldGenerationSizeMb: 96, maxYoungGenerationSizeMb: 16, stackSizeMb: 2 },
        env: {}, execArgv: [],
      });
      worker.once('message', report => void finish(report));
      worker.once('error', () => void finish(failure('ERROR', 'WORKER_FAILED')));
      worker.once('exit', () => { if (!settled) void finish(failure('ERROR', 'WORKER_NO_RESULT')); });
    } catch { void finish(failure('ERROR', 'WORKER_FAILED')); }
  });
}
export async function verifyReceipt(root, previous, options = {}) {
  const current = await auditSkillDirectory(root, options);
  const valid = previous?.schemaVersion === 1 && previous.status === 'NO_FINDINGS' && previous.coverage?.complete === true &&
    current.status === 'NO_FINDINGS' && ['rootId','engineHash','rulesHash','inventoryHash'].every(k => current[k] === previous[k]);
  return { valid, executionAuthorized: false, current };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const allowed = args.length === 1 || args.length === 5 && args[1] === '--rules' && args[3] === '--rules-sha256';
  const result = allowed ? await auditSkillDirectory(path.resolve(args[0]), {
    ...(args.length === 5 ? { rulesPath: path.resolve(args[2]), expectedRulesHash: args[4] } : {}),
  }) : failure('ERROR', 'INVALID_CLI_ARGUMENTS');
  console.log(JSON.stringify(result));
  process.exitCode = result.status === 'NO_FINDINGS' ? 0 : result.status === 'ERROR' ? 3 : result.status === 'INCOMPLETE' ? 2 : 1;
}
