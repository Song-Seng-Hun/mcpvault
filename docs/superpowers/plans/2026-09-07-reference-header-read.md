# Header-only reference discovery implementation plan

> Execute inline with executing-plans and TDD under delegated design approval.

**Goal:** Stop reading irrelevant bodies during no-index reference lookup and
reject candidates whose access changed during asynchronous discovery.

**Architecture:** Reuse HeaderCollector for early-completing reads, admit them
through the shared coordinator, and retain reference semantics/visibility.

**Tech Stack:** TypeScript, Node fs/StringDecoder, existing parser and Vitest.

- [x] Add `src/reference-header-read.test.ts`: a 2 MiB note with a short alias
  header and parser-input spy must resolve correctly without parsing the body.
  Revoke access from the parser callback on a real source; require no match.
  Run the file single-worker and observe these assertions fail before code.
- [x] Add `HeaderCollector.complete` getter and `readUtf8HeaderSource(path)` in
  `src/streaming-metadata.ts`. Open/stat regular file, allocate 64 KiB, decode
  chunks with StringDecoder, feed collector until complete or EOF, feed decoder
  end at EOF, return finish(); finally close on all exits. Never return a hash.
- [x] In `src/vault-io.ts`, add headerReader option/default plus
  `readUtf8Header(path, priority='foreground')`, scheduling `['header', path]`.
  Same queue/adaptive rules, no cache or result collision with other operations.
- [x] In fallback `src/filesystem.ts` reference discovery, use the header reader
  and parse only header. Recheck path/access before IO, after IO and before
  building descriptors' index; add canReference guard preserving an existing
  options predicate. Keep 32 batch, omission on storage error and sorted results.
- [x] Add real FS byte/close probes for early stop, long/unclosed headers,
  delimiter split and malformed UTF-8, fault close. Add scheduler coalescing /
  operation isolation and fallback revocation across batches, inaccessible
  prefiltering, alias ambiguity/relative Markdown regression cases.
- [x] Run focused tests, build, independent read-only integrity review, then
  full `npm test -- --maxWorkers=1` sequentially. Fix genuine regressions, update
  docs with the non-revision boundary and diff check.
- [x] Stage explicit source/dist/
  tests/docs, commit and push origin main only, verify SHA and record results.

## Verification in progress

- RED on old implementation: parser input length 2,097,180 instead of 27;
  a candidate revoked while its Properties were processed still returned
  `Secret.md`. New tests use a numeric size assertion before string comparison
  so future failures cannot dump the full synthetic body as a diff.
- GREEN: focused 4-file suite, 41 tests passed. Real FileHandle probes measured
  exactly 65,536 source bytes for a 2 MiB body with a short closed header/plain
  text; split delimiters needed the second chunk. Unclosed multibyte/malformed
  input was consumed to EOF, and early completion/error paths closed handles.
- Later-batch revocation cannot return the revoked alias owner and still returns
  the visible owner. Pre-denied candidates cause no header read. Existing alias
  ambiguity, root-first ordering and explicit relative Markdown behavior pass.
- Build passed. Independent Astra read-only security/integrity review found no
  actionable issue; reviewer closed. Full single-worker suite passed: 188 files,
  2,917 tests passed, 2 skipped (2,919 total), 334.19 seconds, terminal exit 0.
  Staged diff check passed. No runtime restart/config change or live Vault write.
- This is an I/O-count fixture, not a whole-server performance benchmark. Header
  discovery deliberately provides no body digest, new memory ceiling, or claim
  that unseen body changes have been verified.

## Delivery

Implementation `5b10030aada93c633444f042cc2fd6e58c2ed308` was pushed to
`https://github.com/Song-Seng-Hun/mcpvault.git` main. Live `git ls-remote`
matched local HEAD. Only unrelated untracked `.agents/` and `.mcpvault/` remained;
neither was staged. No upstream contribution, release, package publish or runtime
restart. This completed increment does not close the broader active Goal.
