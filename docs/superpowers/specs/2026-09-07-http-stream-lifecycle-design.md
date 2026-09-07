# HTTP response stream lifecycle

## Scope and authority

Continue the approved resource-reduction work in the user's fork. No client
installation, endpoint, credential, scope, or live document changes. The prior
read-path change eliminated duplicate checks; remaining median HTTP overhead
has not been attributed. This increment addresses an independently observable
resource-lifecycle defect, not a claim to explain that latency gap.

## Evidence and design

`mcp-http.ts` drains a Web response using an unawaited async loop. It ignores
`ServerResponse.write()` backpressure, does not cancel a pending upstream read
on disconnect, and lets read failures escape as detached rejections.

Use Node's standard `Readable.fromWeb` plus awaited `pipeline` to couple the
producer to the actual socket's backpressure and cancellation. Retain response
status/headers and the no-body path. A stream failure terminates that response;
never append a second JSON error to an already-started or destroyed response.
Existing pre-response validation errors retain their current bounded behavior.

Alternatives: a hand-built drain/close/error state machine has more race and
listener-cleanup paths; buffering the entire response defeats bounded memory.
The standard pipeline is the narrowest lifecycle owner. This does not bound
allocations already made by the SDK producer or kernel socket buffers.

## Acceptance and execution plan

1. Reproduce paused-client buffering and pending-read cancellation failures on
   real loopback sockets with a controlled SDK Web-response producer.
2. Apply the stream bridge fix; cover full byte/header delivery, stream errors,
   bodyless responses, and continued server availability.
3. Run targeted HTTP/runtime tests, build, all tests sequentially with one
   worker, and diff checks. Review lifecycle/security regressions.
4. Commit generated dist with source and tests; push only the user's fork main.
   If deploying, first revalidate the exact scheduled task and process owner,
   restart only that server, and verify a native MCP read.

No GPU downloads, broad process termination, or live test accounts are needed.

## Verification evidence

- Before implementation: the paused consumer caused all 512 x 64 KiB chunks
  to be consumed; disconnect cancellation remained false. Both new assertions
  failed. A third reproduction produced an unhandled rejection and marked the
  truncated response complete after an upstream error.
- After implementation: targeted HTTP tests passed 19/19 (three files). The
  eight new cases use real Node sockets and Web streams, substituting only the
  SDK response producer/runtime construction. Existing SDK integration cases
  continue to exercise negotiation, bearer identity, shared runtime behavior,
  warmed search invalidation and revision conflicts.
- The paused-client test establishes repeated stable production while the
  actual outgoing socket requires drain, then resumes and receives the entire
  32 MiB synthetic stream. A separate byte-equality test includes Korean data.
- Pending-read cancellation, a response arriving after disconnect, failure
  before/after headers, bodyless completion, and same-socket keep-alive reuse
  are covered. A failed stream aborts the connection; it is not a successful
  truncated MCP result.
- `npm run build` passed. Full suite: 197 files passed; 2,998 tests passed and
  two existing skips (3,000 total), exit 0. Command
  `npm test -- --maxWorkers=1`, started 2026-09-07 12:48:28 local, 382.32 s.
  `git -c core.safecrlf=false diff --check` passed.
- Astra High reviewed the bounded production diff and found no blocker. Its
  test-coverage cautions led to sustained-stall/resume and keep-alive checks;
  late-response/early-error tests were added during review. The reviewer was
  closed after returning its findings.
- Built-server smoke (`node scripts/benchmark-shared-http.mjs --smoke`): one
  client, 16 fixture notes, four validated calls per mode; stdio and HTTP both
  passed with owned-process cleanup verified. Samples are too small for a
  performance improvement claim (HTTP median 15.30 ms, stdio 6.13 ms).
- Deployed only the independently revalidated shared scheduled server:
  `MCPVault-SharedHTTP-8788`, loopback `127.0.0.1:8788`; old PID 27632 exited,
  replacement PID 28408 started at 2026-09-07T12:55:45.0924930+09:00. These are
  historical deployment observations, not permanent process identifiers.
- Native Codex `call_endpoint` -> `notes.read` read `환영합니다!.md` after
  replacement: no error, 2,775 content characters, unchanged revision
  `5b66c8d1ec9f2dbdfdcdca4bba6f1ddd08d0722bce2af9944a8605aedc0c19de`.
  No Codex restart, live content edit, or account creation was needed.

## Limits and remaining work

This proves bounded bridge buffering for the tested chunk size, not constant
memory for arbitrary SDK chunks or producer allocations. Generic Web-stream
cancellation is proven; cancellation of every SDK-internal task is not. Test
cleanup closes owned connections and is not a leak-duration benchmark. Request
work that never returns a response still needs separate abort-propagation
analysis. The shared gate admits three anonymous benchmark calls below its
eight-per-key limit, so its queue is not the likely source of that workload's
remaining HTTP delay; no general HTTP latency speedup is claimed here.

Separately, the installed agent skill and the live welcome still carry older
onboarding wording than current `AGENTS.md`/orientation. They were read but not
changed by this transport increment; reconcile those guides in a subsequent
bounded change, without registering accounts or expanding first-read budgets.
