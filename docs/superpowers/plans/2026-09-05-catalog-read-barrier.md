# Received-change read barrier implementation plan

> Execute inline with systematic-debugging, TDD and verification-before-completion. No agents; authorized fork main only.

**Goal:** Prevent current metadata/graph/work/search reads from ignoring already-received filesystem change notifications still in the catalog's debounce queue.

**Architecture:** Add a coalesced catalog flushPendingEvents barrier which joins any active batch, cancels the pending debounce timer and flushes the received batch. Metadata and graph read preparation await it before deciding which indexes are clean. Catalog inventory reads and lexical search's cache fast path also use it. Search invalidation detaches old in-flight computations from later readers. Keep batched background updates; unchanged reads do not force stat calls or recursive inventory walks.

**Tech Stack:** Existing VaultFileCatalog, VaultMetadataIndex, VaultGraphIndex, FileSystemService/LlmWikiService, Vitest temporary Vaults and committed dist.

## Diagnosis and boundaries

- Catalog onFilesystemEvent invalidates its own directory state immediately but delays subscriber delivery by 50ms. Metadata ensureFresh and graph ensure check only their own dirty/full-refresh flags, so they can return old rows while the shared catalog already knows about a change.
- Waiting projects, new backlinks, metadata edits and deletes share this boundary. Fix the common read preparation, not the individual dashboard or its test timings.
- Alternatives: sleep for the debounce interval (unreliable and unnecessary); scan every directory on every query (adds unrelated IO); drain already-received notifications before index selection (chosen).
- A barrier covers received events, not notifications still withheld by the OS. It is not a globally atomic filesystem snapshot; missing watcher events and periodic reconciliation remain separate. Do not claim all external writes become immediately observable under every filesystem.
- Concurrent read barriers share a promise. Join an in-flight batch before flushing the received queue. Events arriving after a batch snapshot belong to the next batch; do not create an unbounded wait-until-no-writer loop.
- Full/unknown path events must notify subscribers before they choose a cached view. Direct known-file changes must preserve incremental refresh and duplicate-event coalescing. Closed catalogs must not emit callbacks.

## Tasks

- [x] Add deterministic tests that suppress real watcher timing, seed real files and inject the already-received event at the catalog boundary. Cover new waiting project, metadata edit/delete, new/deleted backlink, unknown/full event, concurrent barriers, in-flight batch and close. Observe failures before implementation.

```ts
await service.reviewDashboard(); // warm indexes
await writeFile(waitingPath, waitingMarkdown);
catalog.onFilesystemEvent('Projects/Waiting.md'); // test-only boundary injection
expect((await service.reviewDashboard()).sections.waiting.items).toContainEqual(expect.objectContaining({ path: 'Projects/Waiting.md' }));
```

- [x] Implement public flushPendingEvents in src/vault-catalog.ts using the existing serialized flush chain and timer, then call it from listInventory, metadata ensureFresh, graph ensure and search cache lookup. No extra endpoint or client setting.
- [x] Verify one-path events avoid refreshAll/recursive walks after warmup and keep exact source revision behavior. Check watcher batching and existing index tests.
- [x] Update README/schema/roadmap with the received-event guarantee and remaining OS-delivery limit; retain the observed archive timeout separately.
- [x] Build, run targeted and full tests, diff check and inline review. Publish
  source/tests/docs/dist together to the authorized fork main; verify the actual
  remote hash after push separately from these local validation results.

## Verification and inline review

- Initial six catalog/metadata/graph boundary tests failed before the barrier;
  they and five lifecycle/coalescing/failure/clean-IO cases passed after it.
- Search cache tests independently failed with a cached miss and stale hidden
  text. The hidden-text fixture first needed explicit initial catalog delivery
  to test the intended failure, not initial inventory setup.
- A real blocked pre-change search then reproduced a later reader joining its
  stale computation. Detaching the in-flight map on invalidation fixes this;
  the existing generation check and identity-checked finalizer protect the new
  cache entry and newer computation. Old callers are not claimed atomic.
- Targeted catalog/index/graph/search suite: 5 files, 66 tests passed; new
  deterministic barrier suite contains 14 tests. Build passed.
- Compiled `dist` smoke through a real linked MCP client and public
  `call_endpoint`: exactly five tools, cached-miss invalidation after delivered
  addition, 512-character search bound and removal after delivered moderation
  hiding all passed. It used an owned temporary Vault, not the live server.
- First full suite: 886 passed, one skipped, five 5000ms timeouts (archive
  long-path, chat, community features, ideation and moderation); three timed-out
  suites also reported temporary-directory cleanup races. Their unchanged
  isolated group passed 47 tests in 9.19s. Second unchanged full `npm test`:
  58 files passed, 891 passed and one skipped, 43.81s. No timeout, assertion or
  worker-count configuration was relaxed. Intermittent load/cleanup behavior
  remains a verification risk, not a resolved defect.
- Inline review retained shared service boundaries, no new MCP/write surface,
  no additional client setup, existing scope/revision enforcement, and no
  full scan for a clean query. Separate stat-error classification, watcher-error
  subscriber delivery and OS delivery gaps are recorded in the roadmap rather
  than being represented as solved by this barrier.
