# Header-only reference discovery implementation plan

> Execute inline with executing-plans and TDD under delegated design approval.

**Goal:** Stop reading irrelevant bodies during no-index reference lookup and
reject candidates whose access changed during asynchronous discovery.

**Architecture:** Reuse HeaderCollector for early-completing reads, admit them
through the shared coordinator, and retain reference semantics/visibility.

**Tech Stack:** TypeScript, Node fs/StringDecoder, existing parser and Vitest.

- [ ] Add `src/reference-header-read.test.ts`: a 2 MiB note with a short alias
  header and parser-input spy must resolve correctly without parsing the body.
  Revoke access from the parser callback on a real source; require no match.
  Run the file single-worker and observe these assertions fail before code.
- [ ] Add `HeaderCollector.complete` getter and `readUtf8HeaderSource(path)` in
  `src/streaming-metadata.ts`. Open/stat regular file, allocate 64 KiB, decode
  chunks with StringDecoder, feed collector until complete or EOF, feed decoder
  end at EOF, return finish(); finally close on all exits. Never return a hash.
- [ ] In `src/vault-io.ts`, add headerReader option/default plus
  `readUtf8Header(path, priority='foreground')`, scheduling `['header', path]`.
  Same queue/adaptive rules, no cache or result collision with other operations.
- [ ] In fallback `src/filesystem.ts` reference discovery, use the header reader
  and parse only header. Recheck path/access before IO, after IO and before
  building descriptors' index; add canReference guard preserving an existing
  options predicate. Keep 32 batch, omission on storage error and sorted results.
- [ ] Add real FS byte/close probes for early stop, long/unclosed headers,
  delimiter split and malformed UTF-8, fault close. Add scheduler coalescing /
  operation isolation and fallback revocation across batches, inaccessible
  prefiltering, alias ambiguity/relative Markdown regression cases.
- [ ] Run focused tests, build, independent read-only integrity review, then
  full `npm test -- --maxWorkers=1` sequentially. Fix genuine regressions, update
  docs with the non-revision boundary, diff check, stage explicit source/dist/
  tests/docs, commit and push origin main only, verify SHA and record results.
