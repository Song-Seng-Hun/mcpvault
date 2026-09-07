# Dedicated HTTP lifecycle implementation plan

> Execute inline with executing-plans and TDD; user delegated design approval.

**Goal:** One-command HTTP-only serving with explicit shared runtime ownership.
**Architecture:** CLI parses an optional stdio=false mode; lightweight transport
wrappers never close root services; one lifecycle owns ordered best-effort close.
**Tech Stack:** TypeScript, Node, installed MCP SDK, Vitest, disposable processes.

- [x] RED: extend src/cli.test.ts with `parseCliArgs(['/vault',
  '--mcp-http-only=0'])` expecting mcpHttpPort:0, stdio:false and preserved path;
  bare/default/separate/invalid forms too. Add src/server-lifecycle.test.ts:
  close transport then root, call twice only closes once, rejected transport
  does not skip root and close reports errors. Run these targeted tests.
- [x] Implement src/cli.ts: optional `stdio?: false`; share MCP-port parsing
  between --mcp-http and --mcp-http-only, set false only for the latter.
  Add src/server-lifecycle.ts with createServerLifecycle(root), add(handle),
  close():Promise<unknown[]>; store close promise before asynchronous iteration,
  close handles in reverse acquisition order, then root; collect each error.
- [x] Update server.ts: create lifecycle immediately after runtime, serve stdio
  only when stdio!==false with runtime.createRequestServer; register each
  successfully acquired transport. Wrap startup in try/catch, report the error,
  await lifecycle close before exit1. Shutdown uses same close and exit0
  (or exit1 on cleanup errors). Preserve stdio-only EOF handlers and signals.
- [x] Build. Add src/http-only-process.test.ts using the built entry point,
  temp fixture and port0; read bounded stderr until listening URL, create two
  real SDK clients, seed unique note, send stdio initialization then EOF,
  verify HTTP search with empty stdout, detach first and read via second.
  Reject malformed port and occupied port with nonzero exit. Kill only the
  fixture child in finally, await its exit, validate temp root before removal.
- [x] Targets: CLI/lifecycle/process/shutdown/runtime-sharing/mcp-http tests,
  build, read-only review; `npm test -- --maxWorkers=1`, `git diff --check`.
  README/help explain one server URL shared by clients, no live config migration
  and no auto background daemon.
- [x] Explicit source/dist/docs staging, fork-only commit/push, verify remote
  SHA; keep broader Goal active.

## Evidence

- CLI RED: --mcp-http-only remained part of the vault path instead of selecting
  HTTP-only mode. Lifecycle test import was initially missing as expected.
- Real-process RED against the previous published entrypoint: no HTTP listening
  URL for --mcp-http-only; with --http=0 only REST started and the expected
  occupied MCP port did not fail. Each child was killed only in fixture cleanup
  after the expected bounded readiness failure; no matching temp dirs remain.
- CLI/lifecycle GREEN: 2 files / 15 tests passed. Build passed.
- Targeted CLI/lifecycle/process/shutdown/runtime-sharing/MCP-HTTP suite:
  6 files / 28 tests passed, 11.93s, start 10:09:15 local.
- Added a positive-control dual-transport test: a real stdio initialize response
  is received, then HTTP reads still work after stdin EOF. Final process file:
  3 tests passed, 3.61s, start 10:11:02 local. Child env explicitly removes
  VITEST to exercise production tool visibility, plus operator MCPVAULT settings
  to retain isolated loopback configuration. No native model download/inference.
- Astra read-only review identified a potential fatal-stdio-wire close regression:
  only the request wrapper closes on stdout failure; EOF/signal might never
  follow. Reviewer also requested stronger entrypoint cleanup evidence than exit
  code/SIGKILL. Reviewer is closed. Reproduce with an observational preload,
  add root-cleanup witnesses for graceful/startup-failure paths, and keep dual
  HTTP service alive across stdio wire failure. Full run already in progress
  precedes this refinement and will not be used as final verification.
- Final independent feedback handling/full suite/publication pending.

### Review refinement evidence

- Pre-refinement full suite passed: 194 files / 2,973 passed / 2 skipped,
  369.54s, start 10:12:39 local. Not the final evidence for the later wire fix.
- Preload initially needed pathToFileURL for Node --import on Windows; corrected
  this fixture setup error before evaluating behavior. Valid reproduction then
  passed five process tests but failed the terminal stdio wire test: injected
  stdout EPIPE was logged while no root cleanup marker appeared before timeout.
- Fixed only actual StdioServerTransport.close: perform wire close, then initiate
  CLI shutdown when no network adapter owns the runtime. Do not close on generic
  onerror or probe-product disposal. Shutdown remains idempotent and does not
  await itself. Installed SDK transport API was inspected directly.
- Build passed; refined targets: 6 files / 32 tests passed, 15.89s,
  start 10:20:59 local. Observer records root close only after existing service
  cleanup and real Server.close finish; no resource implementation is mocked.
  IPC signal event exercises the real entrypoint handler, not Windows OS signal
  delivery. Fault injection observes cleanup with an IPC handle still active;
  it is not a measurement of naturally orphaned production processes.
- Added recoverable parse-error/negotiation/EOF coverage and requested a narrow
  Terra review of wire callback lifetime and proof boundaries. Final full suite
  and fork publication remain pending.
- Final process file: 7 tests passed, 7.45s, start 10:22:01 local. Terra found no
  additional defects in the callback/lifecycle path; worker closed. Review is
  static, not an independent benchmark/test execution. A synthetic EPIPE after
  negotiation does not prove every OS-level pre-handshake failure mode.

## Final verification

- Final full suite: 194 files / 2,977 passed / 2 skipped (2,979 total),
  403.42s, start 10:23:35 local, exit 0. Production and test code unchanged
  since that run. Build passed before this suite.
- `node dist/server.js --mcp-http-only=invalid` exits 1 from parseCliArgs before
  root runtime construction. `node dist/server.js --help` exits 0 and documents
  the new option. Neither touches a live Vault or starts a server.
- Published `8b0060bea1b55ad62a97e434ca77208c633fd71f` to
  Song-Seng-Hun/mcpvault main; git ls-remote matched the local SHA. No upstream
  contribution. Installed plugin configuration, existing servers, real
  accounts and Vault content remain unchanged. This delivery entry is docs only.

## Next work

The broader Goal remains active. Quantify the resource effect with a bounded,
same-workload comparison of isolated per-client runtimes versus one HTTP-only
runtime. Existing memory scripts measure parser/metadata units, not that server
deployment contrast. Separate sum-of-process RSS from unique physical RAM,
startup/steady-state memory, native-model load and client overhead. Keep native
downloads off by default and never mistake this feature's presence for live
client migration or measured VRAM savings.
