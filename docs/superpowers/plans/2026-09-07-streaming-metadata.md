# Streaming metadata implementation plan

> Execute inline with executing-plans and TDD under delegated approval. Request
> a bounded independent review for revision/coordinator integrity.

**Goal:** Metadata reads retain only a leading header and a same-stream digest.

**Architecture:** Extend the existing streaming digest with a synchronous text
consumer, collect a header in a separate module, schedule its immutable result
under a distinct coordinator key, and parse it in FileSystemService.

**Tech Stack:** TypeScript, Node fs/StringDecoder/crypto, Vitest, existing YAML.

- [x] Add `src/streaming-metadata.test.ts`: real temporary file with a small YAML
  header plus 2 MiB body; inject the existing coordinator and spy both whole-body
  methods. Assert metadata and SHA256(decoded text), and zero full-reader calls.
  Run `npm test -- src/streaming-metadata.test.ts --maxWorkers=1`; observe RED.
- [x] In `src/streaming-revision.ts`, add optional synchronous decoded-text
  callback to `hashUtf8Source(path, maxBytes?, consume?)`. Deliver each write
  and final end string to both hash and consumer before returning, keeping
  validation/open/stat/read/close unchanged. Consumer errors must still close.
- [x] Create `src/streaming-metadata.ts` exporting HeaderCollector and
  `readUtf8MetadataSource(path, maxBytes?)`. Collector waits for four normalized
  opener characters, rejects non-openers, retains chunks only until first
  `\n---`, checks three-character carry across chunks, and joins once at finish.
  Return `Object.freeze({ header: collector.finish(), revision })`.
- [x] In `src/vault-io.ts`, allow scheduled string or immutable header/revision
  results; keep queue/adaptive logic shared. Add metadataReader option and
  `readUtf8Metadata` with pre-key limit validation and `metadata` key namespace.
  Use private generic schedule with the operation-key/result-type invariant
  documented. No serialization roundtrip, cloning body, or second scheduler.
- [x] In `src/filesystem.ts` fresh metadata loop, replace raw reader/hash with
  `await this.vaultIo.readUtf8Metadata(this.resolvePath(path), options.maxBytes)`;
  parse header with existing handler and return its independent Properties and
  returned revision after the unchanged access check. Index path stays intact.
- [x] Extend real-file and collector differential fixtures, caps, failures,
  revocation, mutable isolation and coordinator concurrency tests. Confirm
  current parser equality at every delimiter split and decoder edge, including
  legacy unclosed headers. Never evaluate executable input in a legacy oracle.
- [x] Run targeted tests, `npm run build`, independent review and
  `npm test -- --maxWorkers=1` sequentially; repair evidenced regressions.
  Update README and follow-up research to state full I/O but header-only
  retention. Run `git diff --check`.
- [x] Stage explicit source/tests/dist/docs,
  commit, push origin main only, verify live remote SHA and record evidence.

## Evidence so far

- RED before implementation: both new fresh-metadata assertions failed because
  `readUtf8` / `readUtf8Bounded` were called once, while result assertions passed.
- Focused verification: 6 files, 76 tests passed, 1 platform-dependent skip.
  Includes delimiter split/character-by-character parser comparisons, same-size
  body changes, caller mutation isolation, scope revocation and strict failures.
- Build passed. Independent Astra read-only integrity review found no actionable
  production regression; reviewer closed. No live Vault or runtime changes.
- First full single-worker run: 8 failed, 2,893 passed, 2 skipped, 329.95 s.
  All eight failures were old-reader probes: archive hash-count observation,
  three strict EIO injection sites and promotion reference EIO/byte-cap probes.
  Source/error expectations were preserved; these five test files now probe
  `readUtf8Metadata` for metadata work, retaining whole-body probes for body work.
- Rerunning those five files: all 122 tests passed. Rebuilt generated output
  successfully. Final full single-worker suite: 186 files passed, 2,901 tests
  passed, 2 skipped (2,903 total), 327.77 seconds, terminal exit 0.
  `git diff --check` and staged diff check passed. All build/test/benchmark
  executions were sequential. No broader Goal completion claim is made.

## Opt-in fixed-fixture measurement

`scripts/benchmark-metadata-memory.mjs` creates and removes its own validated
temporary directory. It writes a safe YAML header and 32 MiB ASCII body in small
blocks, then compares full-string metadata parsing with the new same-stream
projection in separate sequential Node v22.23.2 processes. Both verified the
expected Properties and full revision. It never reads a user's Vault.

| Single invocation | Full-string baseline | Streaming projection |
| --- | ---: | ---: |
| Duration | 120.96 ms | 116.39 ms |
| Maximum RSS | 158.15 MiB | 77.80 MiB |
| Heap before / after | 6.64 / 70.97 MiB | 6.64 / 8.93 MiB |

This is evidence of reduced transient retained text for this fixture, not a
statistical speedup, whole-server memory target, or desktop-lag resolution.
RSS includes startup and fixture writing; ArrayBuffer measurements also include
temporary asynchronous file-writing allocations and collection timing. Every
body byte is still read and hashed. Huge/unclosed headers retain their text
subject to the caller's cap. Existing server processes have not been reloaded.

## Delivery

Implementation `37584aa0c843de586649d47a8e96c1d0561a9a13` was pushed to
`https://github.com/Song-Seng-Hun/mcpvault.git` main. Live `git ls-remote`
matched local HEAD. Only pre-existing untracked `.agents/` and `.mcpvault/`
remained; neither was staged. No upstream PR, release or package publishing.
The broader Goal remains active; metadata index rebuild retention is a separate
remaining candidate, recorded with its required race tests in the follow-up.
