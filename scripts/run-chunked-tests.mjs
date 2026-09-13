// Repository-owned host tooling. No external Vault, model or provider is used.
import { fileURLToPath } from 'node:url';
import { parseOptions } from './testing/config.mjs';
import { runSafeTests } from './testing/runner.mjs';

const controller = new AbortController(), stop = () => controller.abort();
process.on('SIGINT', stop); process.on('SIGTERM', stop);
try {
  process.exitCode = await runSafeTests(fileURLToPath(new URL('..', import.meta.url)), parseOptions(process.argv.slice(2)), controller.signal);
} catch (error) {
  console.error(JSON.stringify({ complete: false, error: error.code ?? error.name, message: 'Safe tests stopped; preserve the run records and inspect the failure before retrying.' })); process.exitCode = 1;
} finally { process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop); }
