# Streaming revision implementation plan

> **For agentic workers:** Use executing-plans for inline work as authorized by
> the user; request an independent bounded review after the implementation.

**Goal:** Bound input retention during revision hashing without changing guards.

**Architecture:** One streaming digest primitive, existing I/O scheduler, shared
filesystem read boundary. No cache, new runtime worker, or MCP surface change.

**Tech Stack:** TypeScript, Node fs/promises, crypto, StringDecoder, Vitest.

- [x] Add `src/streaming-revision.test.ts` with real disposable storage. Initial
  test exercises existing public API and spies on its injected coordinator:
  `expect(await fs.readNoteRevision('Note.md', bytes.length)).toBe(oldHash(bytes));`
  `expect(bodyRead).not.toHaveBeenCalled();` Observe RED on existing body read.
  Use `oldHash = bytes => createHash('sha256').update(bytes.toString('utf8')).digest('hex')`.
- [x] Create `src/streaming-revision.ts` exporting
  `hashUtf8Source(path: string, maxBytes?: number): Promise<string>`. Validate cap
  (safe integer 1..0x7fffffff) before opening. With one `open(path,'r')` handle,
  reject nonregular/oversize from stat; read into one <=65536-byte buffer, limiting
  reads to remaining allowance+1. Track size and reject growth before decode.
  Incrementally hash `decoder.write(buffer.subarray(0, bytesRead))`; at EOF use
  `hash.update(decoder.end()).digest('hex')`. Always await close in finally.
- [x] In `src/vault-io.ts`, add optional `revisionReader` hook and public
  `readUtf8Revision(path, maxBytes?, priority='foreground')` through
  `schedule(JSON.stringify(['revision', maxBytes ?? null, path]), reader, priority)`.
  Default hook is hashUtf8Source. In `src/filesystem.ts`, replace private
  readNoteData with `withNoteRead<T>(path, read:(fullPath:string)=>Promise<T>)`;
  keep its checks/error mapping unchanged, body parsing inside its caller and
  revision lookup via the new coordinator method.
- [x] Expand real-byte/hash/buffer/close/security tests plus scheduler tests in
  `src/vault-io.test.ts`. Instrument only fs handle boundary, preserve actual reads;
  clean only a resolved child of the verified temp base. Run
  `npm test -- src/streaming-revision.test.ts src/vault-io.test.ts src/recall-record-integrity.test.ts src/review-action-revisions.test.ts --maxWorkers=1`.
- [x] Add bounded opt-in disposable-fixture memory comparison under scripts;
  run baseline and stream processes sequentially after build, no live files.
  Record maxRSS/observed heap/buffer peaks and elapsed time, not universal gains.
- [x] Document constraints/results in README and the resource follow-up, review,
  `npm run build`, full `npm test -- --maxWorkers=1`, `git diff --check`.
- [ ] Stage explicit source/tests/docs/dist, commit and push only fork main;
  verify live remote SHA, preserve unrelated .agents/.mcpvault, keep Goal active.

## Evidence

- Initial public-API tests reproduced whole-body reads with and without a byte
  cap (two RED failures), then passed with the streaming implementation.
- The in-flight test reproduced `Infinity` serializing as `null` and sharing an
  unbounded digest instead of rejecting. Validation before scheduler key creation
  now prevents that bypass; the primitive also validates direct calls.
- Real file-handle probes cover buffer reuse, growth limit+1, early oversize,
  read failure and close. Fixture hashes match full UTF-8 decode at every internal
  split of two-, three- and four-byte characters, plus invalid bytes/incomplete
  EOF, BOM, CRLF, NUL and empty input, with and without caps.
- Independent Astra static review reported no production findings. Its identified
  test gap (not every emoji split actually crossed the boundary) was verified and
  corrected with separate per-character fixtures. Reviewer closed.
- Focused suite: five files, 63 passed, one skipped. The skipped test requires
  Windows symlink creation; an escalated targeted attempt was also skipped, so
  no runtime claim is made for that case. Existing path checks were preserved
  structurally and other path/directory/denied/missing tests ran.
- Build passed. The initial full suite finished with 18 failures in six files:
  those probes assumed final guards still called whole-body readers/the old
  string-hash function. Actual final guards now use the streaming reader, so
  counters and fault-injection hooks missed them. Moved these observations to
  the digest path without relaxing any result/access/revision assertions.
  Append/prepend now inject faults explicitly at `revision` versus `body` phases
  and verify their order instead of treating the second body read as hydration.
  All 114 tests in those six files then passed. Full-suite rerun is recorded on
  completion; the first failed run is not counted as validation success.
- A separate Luna static review of only those six test adaptations confirmed
  the existing rejection, write-count, phase-count, no-parser and unchanged-byte
  assertions were preserved and hooks still used real storage; no findings.
  Reviewer closed. This narrower review did not replace the production review.
- Final build and whitespace validation passed. Whole single-worker rerun:
  184 files passed, 2,870 tests passed, two skipped, 332.18 seconds (exit 0).
  No production behavior was changed after the independent production review;
  later edits were fixture adaptations and documentation.

## Disposable memory comparison

Command: `node scripts/benchmark-revision-memory.mjs`, Node v22.23.2, one fresh
process per implementation, sequential, 32 MiB mixed Korean/emoji/ASCII fixture.
The two returned SHA256 digests matched.

| Observation | Full decoded string | Streaming decoded hash |
| --- | ---: | ---: |
| OS maxRSS, MiB | 161.43 | 55.31 |
| Observed heap peak, MiB | 77.83 | 5.68 |
| Observed ArrayBuffer peak, MiB | 0.52 | 0.08 |
| Elapsed time, ms | 245 | 239 |

One sample per mode, not a speed benchmark: the OS cache/order and runtime affect
timing, 5ms samples can miss peaks, and maxRSS includes process startup. This
measures the hash primitive, not a whole MCP endpoint or desktop responsiveness.
Total memory is not capped at 64 KiB; the reusable input buffer is. Simultaneous
body and digest requests are separate operations, so a mixed workload can do
more I/O than the former shared whole-body read. Scope/revision safety, existing
read backpressure and no persistent content cache take precedence over that reuse.
