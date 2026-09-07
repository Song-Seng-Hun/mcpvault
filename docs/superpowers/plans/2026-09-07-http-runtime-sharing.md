# HTTP runtime sharing implementation plan

> Execute inline using executing-plans and TDD; user design approval delegated.

**Goal:** Verify shared HTTP resource ownership and avoid rebuilding static catalogs.
**Architecture:** One runtime service closure; idempotent schema preparation,
fresh lightweight request servers, per-call authentication unchanged.
**Tech Stack:** TypeScript, existing MCP SDK HTTP clients, Vitest.

- [x] Create `src/http-runtime-sharing.test.ts` disposable fixture with guarded
  cleanup, actual loopback HTTP adapter and two SDK clients. Spy on registry
  setTools after createServer; repeated list calls and ensure must not invoke
  it. Assert non-auth descriptor accessToken is present before the first list.
  Run to RED with `npm test -- src/http-runtime-sharing.test.ts --maxWorkers=1`.
- [x] In `src/createServer.ts`, replace buildCatalogTools wrapper with a
  preparation that maps non-auth input schemas/properties to copied objects
  adding optional accessToken. Add boolean initialized guard around
  endpointRegistry.setTools, invoke it once at construction. tools/list returns
  FIXED_MCP_TOOLS only; runtime exposes the same ensure function.
- [x] Extend tests with real constructor witnesses for catalog, metadata,
  graph, search and semantic services; one top-level runtime creates one each,
  two runtimes create two each, request wrappers create none. Test client detach,
  concurrent identity A/B and anonymous whoami, and fresh request wrappers.
- [x] Focused HTTP/createServer/auth tests, build, independent review, full
  one-worker tests, diff check. Record separate-runtime limitations and no
  native-model/RSS measurement claim. Leave live configuration alone.
- [x] Commit/push the verified implementation and verify fork main SHA.

## Evidence

- RED 09:38 local: missing accessToken schema before first list; four tools/list
  calls plus two ensure calls caused six registry rebuilds and replaced the
  descriptor object. The assertion now reports call count only to avoid dumping
  the entire static catalog on failures.
- Focused new/HTTP/createServer tests: 3 files / 48 tests passed, 19.03s at
  09:40:49 local. New file has four tests. Real HTTP clients observe one each of
  five service owners, fresh request wrappers, survival after one client closes,
  separate top-level owners and independently authenticated/anonymous calls.
- Initial build found schema JSON types widened by a Record<string,unknown>
  assertion. Retaining the existing Tool inputSchema type fixed TS2322;
  subsequent `npm run build` passed without behavioral changes.
- No native embedding/model download, RSS measurement, live reconfiguration,
  existing-process termination or automatic shared launcher is claimed.
- Initial full suite: 192 files / 2,964 passed / 2 skipped, 378.39s,
  start 09:42:35 local. This preceded the stronger review-driven tests below.
- Independent Astra review found no production regression, but identified two
  proof gaps: listTools alone cannot show service survival, and whoami bypasses
  ordinary authorization. The review worker has been closed.
- Added close witnesses for all five owners plus a real lexical search after
  client detach; concurrent own/foreign/anonymous agent-scope reads; permission
  changes, re-login, discovery and write rejection/success without a rebuild;
  revoked-token rejection; REST startup and module-schema immutability checks.
  All accounts/files are disposable fixtures, not live Vault content.
- Strengthened focused file: 6 tests passed, 5.64s at 09:51:22 local;
  subsequent build passed.
- Final full suite including review improvements: 192 files / 2,966 passed /
  2 skipped (2,968 total), 373.67s, start 09:52:10 local; exit 0.
  `git diff --check` passed. No production code changed after this run.
- Published implementation `be790ea25e6f2da73cf72c64886309669672d6ae` to
  Song-Seng-Hun/mcpvault main; `git ls-remote origin refs/heads/main` matched
  the local SHA. No upstream contribution. Unrelated `.agents/` and
  `.mcpvault/` remain untracked. This delivery entry is documentation only.

## Next boundary

This increment removes recurring catalog allocation and proves existing HTTP
service ownership; it does not consolidate independently launched stdio
processes. A shared attachment design still needs authenticated endpoint
identity, startup race/ownership protection, compatible client lifecycle and
isolated resource measurements before any live deployment change. GPU and
worker offload remain separate measured experiments, not assumed benefits.
The broader Goal remains active.
