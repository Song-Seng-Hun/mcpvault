# Streaming metadata implementation plan

> Execute inline with executing-plans and TDD under delegated approval. Request
> a bounded independent review for revision/coordinator integrity.

**Goal:** Metadata reads retain only a leading header and a same-stream digest.

**Architecture:** Extend the existing streaming digest with a synchronous text
consumer, collect a header in a separate module, schedule its immutable result
under a distinct coordinator key, and parse it in FileSystemService.

**Tech Stack:** TypeScript, Node fs/StringDecoder/crypto, Vitest, existing YAML.

- [ ] Add `src/streaming-metadata.test.ts`: real temporary file with a small YAML
  header plus 2 MiB body; inject the existing coordinator and spy both whole-body
  methods. Assert metadata and SHA256(decoded text), and zero full-reader calls.
  Run `npm test -- src/streaming-metadata.test.ts --maxWorkers=1`; observe RED.
- [ ] In `src/streaming-revision.ts`, add optional synchronous decoded-text
  callback to `hashUtf8Source(path, maxBytes?, consume?)`. Deliver each write
  and final end string to both hash and consumer before returning, keeping
  validation/open/stat/read/close unchanged. Consumer errors must still close.
- [ ] Create `src/streaming-metadata.ts` exporting HeaderCollector and
  `readUtf8MetadataSource(path, maxBytes?)`. Collector waits for four normalized
  opener characters, rejects non-openers, retains chunks only until first
  `\n---`, checks three-character carry across chunks, and joins once at finish.
  Return `Object.freeze({ header: collector.finish(), revision })`.
- [ ] In `src/vault-io.ts`, allow scheduled string or immutable header/revision
  results; keep queue/adaptive logic shared. Add metadataReader option and
  `readUtf8Metadata` with pre-key limit validation and `metadata` key namespace.
  Use private generic schedule with the operation-key/result-type invariant
  documented. No serialization roundtrip, cloning body, or second scheduler.
- [ ] In `src/filesystem.ts` fresh metadata loop, replace raw reader/hash with
  `await this.vaultIo.readUtf8Metadata(this.resolvePath(path), options.maxBytes)`;
  parse header with existing handler and return its independent Properties and
  returned revision after the unchanged access check. Index path stays intact.
- [ ] Extend real-file and collector differential fixtures, caps, failures,
  revocation, mutable isolation and coordinator concurrency tests. Confirm
  current parser equality at every delimiter split and decoder edge, including
  legacy unclosed headers. Never evaluate executable input in a legacy oracle.
- [ ] Run targeted tests, `npm run build`, independent review and
  `npm test -- --maxWorkers=1` sequentially; repair evidenced regressions.
  Update README and follow-up research to state full I/O but header-only
  retention. Run `git diff --check`. Stage explicit source/tests/dist/docs,
  commit, push origin main only, verify live remote SHA and record evidence.
