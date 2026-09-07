# Equal-workload shared HTTP measurement

The user delegated design approval and approved fork-main work. This is an
opt-in Windows diagnostic, not a new MCP feature or client installation.

Compare three SDK clients using three stdio server processes against the same
three clients sharing one HTTP-only server. Use fresh identical synthetic
Vaults (256 small notes), read-only mode, lexical search and bounded note reads.
Run stdio/HTTP/HTTP/stdio sequentially to expose order effects. No live paths,
ports, accounts, credentials, downloads or native model activation are accepted.

Measure group startup, warm-up, per-request median/p95 latency, workload elapsed
time and process CPU time. Sample server-only working set and private memory
before/after the timed workload using Windows Get-Process for exact owned PIDs.
Do not label sampled working set as unique physical RAM or peak memory. Exclude
the driver/PowerShell probe from server totals; acknowledge their overhead and
OS/JIT/GC/cache noise. Validate response bodies and identical work counts, not
merely successful requests. No performance thresholds belong in normal CI.

The script accepts only no arguments (bounded comparison) or --smoke (one
client, 16 notes, four rounds, one run per transport), plus the fixed
`--smoke-fail-startup` fault-verification mode. That mode aborts after starting
one real stdio child but before handshake and requires verified cleanup.
Reject arbitrary paths
and workload sizes. Keep subprocess output bounded, use timeouts, close every
owned client/process before validating and deleting only the temporary fixture.
Report failure instead of publishing partial/missing metrics as zeros.

Alternatives rejected: owner counts alone cannot measure memory; live-server
load tests mix with user activity. Native inference and large-Vault/long-run
measurements remain separate work; this first fixture cannot prove desktop-lag
resolution or whole-system scalability.

## Observed comparison, 2026-09-07

Final `node scripts/benchmark-shared-http.mjs` run after review, Node v22.23.2,
Windows, built runtime
from fork commit `2003db5`. Each run has three clients, 256 notes, nine warm-up
calls per client, and 72 measured requests (36 reads, 36 searches). Each run
uses a fresh Vault and closes its owners before the next starts. All responses
passed content/path/revision/budget checks; all four cleanups were verified.

| Run | Owners | Private MiB before/after | Working set MiB before/after | Ready ms | Warm-up ms |
| --- | ---: | ---: | ---: | ---: | ---: |
| stdio 1 | 3 | 382.85 / 386.56 | 353.04 / 357.14 | 5409.34 | 646.56 |
| HTTP 1 | 1 | 130.25 / 133.10 | 121.47 / 124.89 | 1007.93 | 512.80 |
| HTTP 2 | 1 | 129.46 / 132.71 | 121.63 / 124.49 | 1014.82 | 483.71 |
| stdio 2 | 3 | 382.78 / 386.75 | 351.89 / 355.45 | 5334.99 | 513.25 |

| Run | Workload ms | Server CPU ms across snapshots | All median/p95 ms | Read median/p95 ms | Search median/p95 ms |
| --- | ---: | ---: | ---: | ---: | ---: |
| stdio 1 | 234.88 | 796.88 | 10.09 / 11.35 | 11.00 / 11.62 | 7.01 / 10.27 |
| HTTP 1 | 558.15 | 625.00 | 18.72 / 30.43 | 18.91 / 34.85 | 18.49 / 24.91 |
| HTTP 2 | 575.72 | 609.38 | 20.33 / 30.14 | 19.09 / 30.23 | 20.58 / 30.14 |
| stdio 2 | 212.88 | 890.63 | 8.70 / 10.93 | 9.50 / 19.94 | 5.91 / 8.56 |

The sampled private-memory total is about 66% lower with one shared server in
this fixture. HTTP requests are nevertheless slower, consistently in both
orders: roughly 19-20 ms median versus 9-10 ms and 30 ms p95 versus 11 ms. Do not
advertise a latency/throughput improvement. CPU samples include the probe gap,
so they are not a pure per-request CPU profile; three processes can accumulate
CPU in parallel. Startup uses SDK auto negotiation and sequential connections;
it is not a bare transport benchmark. The driver process persists between runs,
so reversing order exposes some noise but does not completely isolate client
JIT and connection-pool state.

Each stdio cache is warmed separately while HTTP clients reuse one shared
cache. This intentionally measures the deployed end-to-end configurations, not
cache-isolated transports. Review strengthened owner tracking before handshake,
live child/transport checks around PID metrics, creation-time comparison from
before warm-up, category counts and bounded result text before JSON parsing.
The startup-failure fixture verifies cleanup of a spawned-but-unconnected child.

A discarded intermediate instrumentation used a StdioClientTransport subclass.
Inspection of the installed SDK's `readStdioServerParams` showed that subclasses
skip its disposable sibling negotiation probe, changing startup time. The final
script wraps only the base instance's start method and preserves its prototype
and negotiation behavior. The tables above use this corrected version. Counts
describe measured connected server owners, not transient SDK negotiation probes.
The initial uninstrumented comparison independently showed the same memory and
request-latency tradeoff; do not use the discarded subclass run for startup claims.

Final focused validation: 3 tests passed, 11.96 seconds at 12:07:23 local;
subsequent `npm run build` passed. Final full suite: 195 files, 2,982 passed /
2 skipped (2,984 total), 397.67 seconds, starting 12:08:40 local, exit 0,
using `npm test -- --maxWorkers=1`. `git diff --check` passed.
After the initial comparison the original live listener still belonged to PID 30852 on
127.0.0.1:8788 with its original 11:26:53 start time; it was not restarted.

The next useful experiment is attribution of HTTP request overhead with a
bounded CPU/event-loop profile, separating request-wrapper/validation work from
HTTP/SDK costs before considering pooling or protocol changes. Keep shared
ownership and per-call identity/scope/revision checks intact. Native embedding,
large graphs, editor watcher latency, long-lived load and desktop responsiveness
remain unmeasured. No production implementation changed in this increment.

Source check for the next attribution step: `src/mcp-http.ts` calls
`runtime.createRequestServer` via the SDK handler; `src/createServer.ts` creates
a fresh protocol Server and installs the two shared handlers. The installed SDK
does construct a default JSON-schema provider per Server, but its Ajv engines
are lazy. Constructor presence alone therefore does not establish expensive
per-request compilation. Do not implement a shared validator or protocol pool
without profiling and identity/lifecycle regression coverage.
