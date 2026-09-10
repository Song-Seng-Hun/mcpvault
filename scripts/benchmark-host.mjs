#!/usr/bin/env node
// Explicit host-only maintenance, resolved from this script rather than CWD.
const { runBenchmarkHost, BENCHMARK_HOST_USAGE } = await import(new URL('../dist/src/benchmark-host-cli.js', import.meta.url));
if (process.argv.length === 2 || process.argv.slice(2).includes('--help')) {
  console.log(BENCHMARK_HOST_USAGE);
} else {
  try { console.log(JSON.stringify(await runBenchmarkHost(process.argv.slice(2)), null, 2)); }
  catch { console.error('Benchmark host operation failed. Verify explicit guards, private configuration and exclusive writer ownership; do not remove a live or abandoned lock automatically.'); process.exitCode = 1; }
}
