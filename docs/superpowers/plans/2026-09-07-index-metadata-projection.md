# Metadata index projection implementation plan

> Use executing-plans inline and TDD under delegated design/main approval.

**Goal:** Build metadata index entries without keeping complete note bodies.

**Architecture:** Reuse the coordinated same-stream header/revision projection
inside readEntry and keep all existing index freshness/error/snapshot machinery.

**Tech Stack:** TypeScript, existing Node streaming reader, YAML, Vitest.

- [ ] Create `src/metadata-index-projection.test.ts`. Write a real temporary note
  with small YAML and a 2 MiB body. Spy coordinator readUtf8 and parser input.
  Verify index.list() returns the correct metadata/hash, calls no whole reader,
  and passes only the header to parse. Repeat for an invalidated same-size edit.
  Run `npm test -- src/metadata-index-projection.test.ts --maxWorkers=1`, see RED.
- [ ] Modify `src/vault-index.ts` readEntry:
  `const source = await this.vaultIo.readUtf8Metadata(fullPath);`
  then `frontmatter: this.frontmatter.parse(source.header).frontmatter` and
  `revision: source.revision`. Remove unused revision(content)/createHash.
  Keep the surrounding stat shortcut and error catch exactly as they are.
- [ ] In `src/metadata-refresh-integrity.test.ts`, change only the injectable
  reader/hook boundary to metadataReader/readUtf8MetadataSource. Invoke afterRead
  after the real projection and before returning it, keeping all generation,
  catalog mutation, failed-batch and concurrent barrier assertions unchanged.
- [ ] Extend disposable index fixtures: deleted source during projection,
  equal-stat body edits, safe and malformed UTF-8/header contracts, successful
  snapshot flush/reopen, and batched small parser input. Existing raw/index
  visibility tests and race fixtures must continue to pass.
- [ ] Run new/race/index/streaming tests sequentially with maxWorkers=1. Build,
  request read-only independent review, then run full `npm test -- --maxWorkers=1`.
  Fix evidenced issues without weakening error/freshness assertions.
- [ ] Update README and resource follow-up: metadata rebuild retention is now
  projected; graph/full-body consumers and giant headers remain distinct.
  Run `git diff --check`, explicitly stage source/tests/dist/docs, commit and
  push only origin main, verify live SHA, record results. No runtime restart.
