# Dedicated HTTP lifecycle implementation plan

> Execute inline with executing-plans and TDD; user delegated design approval.

**Goal:** One-command HTTP-only serving with explicit shared runtime ownership.
**Architecture:** CLI parses an optional stdio=false mode; lightweight transport
wrappers never close root services; one lifecycle owns ordered best-effort close.
**Tech Stack:** TypeScript, Node, installed MCP SDK, Vitest, disposable processes.

- [ ] RED: extend src/cli.test.ts with `parseCliArgs(['/vault',
  '--mcp-http-only=0'])` expecting mcpHttpPort:0, stdio:false and preserved path;
  bare/default/separate/invalid forms too. Add src/server-lifecycle.test.ts:
  close transport then root, call twice only closes once, rejected transport
  does not skip root and close reports errors. Run these targeted tests.
- [ ] Implement src/cli.ts: optional `stdio?: false`; share MCP-port parsing
  between --mcp-http and --mcp-http-only, set false only for the latter.
  Add src/server-lifecycle.ts with createServerLifecycle(root), add(handle),
  close():Promise<unknown[]>; store close promise before asynchronous iteration,
  close handles in reverse acquisition order, then root; collect each error.
- [ ] Update server.ts: create lifecycle immediately after runtime, serve stdio
  only when stdio!==false with runtime.createRequestServer; register each
  successfully acquired transport. Wrap startup in try/catch, await lifecycle
  close before reporting startup error/exit1. Shutdown uses same close and exit0
  (or exit1 on cleanup errors). Preserve stdio-only EOF handlers and signals.
- [ ] Build. Add src/http-only-process.test.ts using the built entry point,
  temp fixture and port0; read bounded stderr until listening URL, create two
  real SDK clients, seed unique note, send stdio initialization then EOF,
  verify HTTP search with empty stdout, detach first and read via second.
  Reject malformed port and occupied port with nonzero exit. Kill only the
  fixture child in finally, await its exit, validate temp root before removal.
- [ ] Targets: CLI/lifecycle/process/shutdown/runtime-sharing/mcp-http tests,
  build, read-only review; `npm test -- --maxWorkers=1`, `git diff --check`.
  README/help explain one server URL shared by clients, no live config migration
  and no auto background daemon. Explicit source/dist/docs staging, fork-only
  commit/push, verify remote SHA; keep broader Goal active.
