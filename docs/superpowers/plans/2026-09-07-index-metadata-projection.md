# Metadata index projection implementation plan

> Use executing-plans inline and TDD under delegated design/main approval.

**Goal:** Build metadata index entries without keeping complete note bodies.

**Architecture:** Reuse the coordinated same-stream header/revision projection
inside readEntry and keep all existing index freshness/error/snapshot machinery.

**Tech Stack:** TypeScript, existing Node streaming reader, YAML, Vitest.

- [x] Create `src/metadata-index-projection.test.ts`. Write a real temporary note
  with small YAML and a 2 MiB body. Spy coordinator readUtf8 and parser input.
  Verify index.list() returns the correct metadata/hash, calls no whole reader,
  and passes only the header to parse. Repeat for an invalidated same-size edit.
  Run `npm test -- src/metadata-index-projection.test.ts --maxWorkers=1`, see RED.
- [x] Modify `src/vault-index.ts` readEntry:
  `const source = await this.vaultIo.readUtf8Metadata(fullPath);`
  then `frontmatter: this.frontmatter.parse(source.header).frontmatter` and
  `revision: source.revision`. Remove unused revision(content)/createHash.
  Keep the surrounding stat shortcut and error catch exactly as they are.
- [x] In `src/metadata-refresh-integrity.test.ts`, change only the injectable
  reader/hook boundary to metadataReader/readUtf8MetadataSource. Invoke afterRead
  after the real projection and before returning it, keeping all generation,
  catalog mutation, failed-batch and concurrent barrier assertions unchanged.
- [x] Extend disposable index fixtures: deleted source during projection,
  equal-stat body edits, safe and malformed UTF-8/header contracts, successful
  snapshot flush/reopen, and batched small parser input. Existing raw/index
  visibility tests and race fixtures must continue to pass.
- [x] Run new/race/index/streaming tests sequentially with maxWorkers=1. Build,
  request read-only independent review, then run full `npm test -- --maxWorkers=1`.
  Fix evidenced issues without weakening error/freshness assertions.
- [ ] Update README and resource follow-up: metadata rebuild retention is now
  projected; graph/full-body consumers and giant headers remain distinct.
  Run `git diff --check`, explicitly stage source/tests/dist/docs, commit and
  push only origin main, verify live SHA, record results. No runtime restart.

## Evidence in progress

- Pre-change RED: both initialization and dirty-refresh tests failed because
  `readUtf8` was called once on a 2 MiB note; metadata and revision assertions
  already matched. After the production change, no full reader is called and
  each parser input is exactly the small leading header.
- Focused 4-file run passed all 27 tests: six new index projection tests plus
  unchanged behavior assertions for dirty/reset/catalog events, concurrent
  callers, sustained churn and error-batch draining. A 35-document fixture
  crosses the 32-read batch boundary without full-body parser inputs.
- Snapshot test flushes the real binary format, verifies its magic, reopens
  unchanged entries without source reads, then invalidates an equal-stat body
  edit and verifies its new digest. This does not claim detection of every
  external edit without a watcher event or invalidation.
- Build passed. A bounded read-only Luna review found no actionable issue in
  production integration or race-hook equivalence; reviewer closed. Full
  single-worker regression suite passed: 187 files, 2,907 passed tests and 2
  skipped (2,909 total), 330.82 seconds, exit 0. Staged diff check passed.
  No parallel test/build/benchmark processes were launched.
- No new whole-index RSS benchmark is claimed. Prior streaming-reader memory
  measurements remain fixture-specific; this increment proves reuse and bounds
  of parser input, not a process-wide heap ceiling or fewer disk bytes.
