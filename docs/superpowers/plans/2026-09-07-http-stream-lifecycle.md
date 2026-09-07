# HTTP stream lifecycle implementation plan

> Execute inline with systematic-debugging and test-driven-development; user
> has already authorized this goal's design, implementation and fork-only push.

**Goal:** Stop eager response buffering, cancel abandoned producers, and contain
stream errors without altering MCP routing, identities or note results.

**Architecture:** `mcp-http.ts` owns Web-to-Node response transfer. Replace its
detached manual pump with awaited Node `pipeline(Readable.fromWeb(body), response)`.
No new exposed functions, endpoint or dependency.

**Tech stack:** TypeScript, Node HTTP/Web Streams, Vitest.

- [x] Add `src/mcp-http-stream.test.ts` using real loopback HTTP and controlled
  SDK producer output; run `npm test -- src/mcp-http-stream.test.ts --maxWorkers=1`.
  Before the fix: all 512 chunks produced for a paused client and disconnect
  cancellation stays false. Both assertions fail for the intended reason.
- [x] Extend coverage for producer failure, normal byte/status/header delivery,
  resumed consumers and bodyless responses. Keep real SDK behavior covered by
  existing `mcp-http.test.ts` and `http-runtime-sharing.test.ts`.
- [x] In `src/mcp-http.ts`, import `Readable` and promise `pipeline`; make
  `writeResponse` async, await the pipeline and await it from requestHandler.
  Before writing error JSON, return for destroyed responses or destroy an
  already-started response. Do not cache/pool authenticated protocol wrappers.
- [x] Run the three targeted test files, `npm run build`, then
  `npm test -- --maxWorkers=1` and `git -c core.safecrlf=false diff --check`.
- [x] Review error/disconnect handling and update verification evidence in the
  spec. Publication gate: stage only this change and generated dist, commit
  and push fork main; the resulting local/remote SHA output is authoritative.
- [x] If deploying now, verify current scheduled task and exact process identity
  before stopping; start the same task only after the old owner exits and the
  port is free. Orientation was read once before deployment; repeat only its
  bounded primary read through Codex after deployment, not the entire onboarding.
