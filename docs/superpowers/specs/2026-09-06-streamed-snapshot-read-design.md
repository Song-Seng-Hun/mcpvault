# Streamed compressed snapshot reads

Design approval is delegated by the user's active Goal. Keep the public cache
reader contract and all authority boundaries; this is not a source-note reader.

## Evidence and choice

`readSnapshotBytes` currently retains all stored chunks, concatenates a complete
stored Buffer, then calls convenience gunzip. Semantic manifests/queues,
notification snapshots and legacy lexical snapshots share this reader. Plain
binary lexical snapshots and legacy plain manifests also use its raw path.

Prefer streaming the compressed input into `createGunzip`, followed by bounded
decoded collection. Whole-buffer gunzip retains avoidable compressed copies;
new binary schemas or streaming JSON would change consumers and are not needed
to remove those copies. The returned decoded Buffer and JSON parse remain O(N),
and collecting decoded chunks before final concat can duplicate decoded bytes.
No constant-memory or measured RSS/latency claim is made.

## Invariants

1. Validate required stored and optional decoded limits before opening a file.
2. Open once, require a regular file within stored cap, and count actual bytes
   read as well: growth after stat cannot exceed the stored cap. Only at most
   one extra stored byte may be read to detect overflow, in <=64 KiB requests.
3. Stream those bounded chunks through gunzip. Count decoded bytes cumulatively
   before retaining each chunk, across all concatenated gzip members.
4. Return bytes only after the entire pipeline succeeds, including checksum and
   trailer validation. Decoder errors, input IO errors, expansion overflow and
   file growth reject with the existing path-free `Snapshot unavailable` error.
5. Always close the single handle on success and failure. Pipeline cancellation
   must stop file iteration; closing must not race a pending file read.
6. Keep raw non-gzip reads and zero-byte files compatible; no new dependency,
   client setup, public tool, source mutation, permission change, or server restart.

## Verification

Real gzip/file tests assert no complete compressed Buffer concatenation, byte
round trip, exact stored/decoded bounds, concatenated-member limits, CRC/trailer
failure, growing-file rejection, downstream cancellation, mid-read IO failure,
handle cleanup and pre-IO argument validation. Preserve existing consumer tests.
Build, focused tests, single-worker full suite, independent review, diff check,
then tracked generated output with source in the user's fork main; no upstream PR.

Reference: Node pipeline error forwarding/destruction and zlib concatenated
member support: https://nodejs.org/api/stream.html#streampipelinesource-transforms-destination-options
and https://nodejs.org/api/zlib.html#class-zlibgunzip.
