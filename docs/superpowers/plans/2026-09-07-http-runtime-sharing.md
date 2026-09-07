# HTTP runtime sharing implementation plan

> Execute inline using executing-plans and TDD; user design approval delegated.

**Goal:** Verify shared HTTP resource ownership and avoid rebuilding static catalogs.
**Architecture:** One runtime service closure; idempotent schema preparation,
fresh lightweight request servers, per-call authentication unchanged.
**Tech Stack:** TypeScript, existing MCP SDK HTTP clients, Vitest.

- [ ] Create `src/http-runtime-sharing.test.ts` disposable fixture with guarded
  cleanup, actual loopback HTTP adapter and two SDK clients. Spy on registry
  setTools after createServer; repeated list calls and ensure must not invoke
  it. Assert non-auth descriptor accessToken is present before the first list.
  Run to RED with `npm test -- src/http-runtime-sharing.test.ts --maxWorkers=1`.
- [ ] In `src/createServer.ts`, replace buildCatalogTools wrapper with a
  preparation that maps non-auth input schemas/properties to copied objects
  adding optional accessToken. Add boolean initialized guard around
  endpointRegistry.setTools, invoke it once at construction. tools/list returns
  FIXED_MCP_TOOLS only; runtime exposes the same ensure function.
- [ ] Extend tests with real constructor witnesses for catalog, metadata,
  graph, search and semantic services; one top-level runtime creates one each,
  two runtimes create two each, request wrappers create none. Test client detach,
  concurrent identity A/B and anonymous whoami, and fresh request wrappers.
- [ ] Focused HTTP/createServer/auth tests, build, independent review, full
  one-worker tests, diff check. Record separate-runtime limitations and no
  native-model/RSS measurement claim. Stage explicit source/dist/docs/tests,
  commit/push fork main only, verify remote SHA. Leave live configuration alone.
