# Metadata snapshot allocation implementation plan

> Execute inline with executing-plans and TDD under delegated approval.

**Goal:** Encode compatible metadata snapshots with one capped output Buffer.

**Architecture:** Focused codec module synchronously prepares scalar/string rows,
checks cumulative limits, writes one exact Buffer; existing IO lifecycle stays.

**Tech Stack:** TypeScript, Node Buffer, existing filesystem snapshot writer, Vitest.

- [ ] Add `src/metadata-snapshot-allocation.test.ts` real temporary Vault test:
  initialize index, spy Buffer.concat and Buffer.from, flush its actual snapshot,
  assert field/final concatenations absent before rereading output. Run to RED.
- [ ] Create `src/metadata-snapshot.ts`, moving codec/constants out of vault-index.
  Export structural MetadataSnapshotEntry and production caps. Encoder default
  limits are 128 MiB / 1M entries; optional values must be safe integers within
  those ceilings, with maxBytes at least the 16-byte header and maxEntries>=0.
  Reject entry count before serialization; capture path/revision/JSON/size/mtime
  once, calculate Buffer.byteLength plus 28-byte row overhead, check total after
  each row, then Buffer.allocUnsafe(total), write strings directly with Buffer.write
  and LE length/double fields. No per-field Buffer.from or Buffer.concat.
- [ ] Import codec/constants into `src/vault-index.ts`; preserve VaultIndexEntry
  interface/export and the unchanged flush/load/rename/debounce flow. Decode
  keeps format checks and adds initial buffer-length ceiling.
- [ ] Extend codec tests with a safe former-codec oracle and exact binary bytes;
  lower test limits prove exact/over byte and count caps reject before allocation,
  undefined/BigInt/cycles fail before write, single serialization capture, Unicode
  and double fields roundtrip. Integration: failed save preserves previous file,
  source/index state and later successful flush.
- [ ] Run targeted codec/index/snapshot tests, build, independent review, then
  all tests with maxWorkers=1 sequentially. Document snapshot allocation bounds
  without a whole-process memory claim. Diff check, explicit stage, commit/push
  only origin main, verify live SHA and record evidence. Leave Goal active.
