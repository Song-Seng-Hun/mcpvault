# Streaming revision implementation plan

> **For agentic workers:** Use executing-plans for inline work as authorized by
> the user; request an independent bounded review after the implementation.

**Goal:** Bound input retention during revision hashing without changing guards.

**Architecture:** One streaming digest primitive, existing I/O scheduler, shared
filesystem read boundary. No cache, new runtime worker, or MCP surface change.

**Tech Stack:** TypeScript, Node fs/promises, crypto, StringDecoder, Vitest.

- [ ] Add `src/streaming-revision.test.ts` with real disposable storage. Initial
  test exercises existing public API and spies on its injected coordinator:
  `expect(await fs.readNoteRevision('Note.md', bytes.length)).toBe(oldHash(bytes));`
  `expect(bodyRead).not.toHaveBeenCalled();` Observe RED on existing body read.
  Use `oldHash = bytes => createHash('sha256').update(bytes.toString('utf8')).digest('hex')`.
- [ ] Create `src/streaming-revision.ts` exporting
  `hashUtf8Source(path: string, maxBytes?: number): Promise<string>`. Validate cap
  (safe integer 1..0x7fffffff) before opening. With one `open(path,'r')` handle,
  reject nonregular/oversize from stat; read into one <=65536-byte buffer, limiting
  reads to remaining allowance+1. Track size and reject growth before decode.
  Incrementally hash `decoder.write(buffer.subarray(0, bytesRead))`; at EOF use
  `hash.update(decoder.end()).digest('hex')`. Always await close in finally.
- [ ] In `src/vault-io.ts`, add optional `revisionReader` hook and public
  `readUtf8Revision(path, maxBytes?, priority='foreground')` through
  `schedule(JSON.stringify(['revision', maxBytes ?? null, path]), reader, priority)`.
  Default hook is hashUtf8Source. In `src/filesystem.ts`, replace private
  readNoteData with `withNoteRead<T>(path, read:(fullPath:string)=>Promise<T>)`;
  keep its checks/error mapping unchanged, body parsing inside its caller and
  revision lookup via the new coordinator method.
- [ ] Expand real-byte/hash/buffer/close/security tests plus scheduler tests in
  `src/vault-io.test.ts`. Instrument only fs handle boundary, preserve actual reads;
  clean only a resolved child of the verified temp base. Run
  `npm test -- src/streaming-revision.test.ts src/vault-io.test.ts src/recall-record-integrity.test.ts src/review-action-revisions.test.ts --maxWorkers=1`.
- [ ] Add bounded opt-in disposable-fixture memory comparison under scripts;
  run baseline and stream processes sequentially after build, no live files.
  Record maxRSS/observed heap/buffer peaks and elapsed time, not universal gains.
- [ ] Document constraints/results in README and the resource follow-up, review,
  `npm run build`, full `npm test -- --maxWorkers=1`, `git diff --check`.
- [ ] Stage explicit source/tests/docs/dist, commit and push only fork main;
  verify live remote SHA, preserve unrelated .agents/.mcpvault, keep Goal active.
