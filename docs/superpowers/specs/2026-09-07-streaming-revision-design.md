# Stream revision reads without changing revision identity

User approved inline design/implementation and fork-main publication. This
continues the resource-reduction follow-up, not a new cache or GPU subsystem.

## Choice and boundaries

The existing revision is SHA256 of the complete UTF-8-decoded string reencoded
as UTF-8. Raw-byte hashing is not equivalent for malformed input. Moving the old
allocation to a worker would retain its memory cost. Choose a reusable 64 KiB
buffer and incremental StringDecoder plus SHA256. This bounds retained input
storage without claiming lower asymptotic CPU or file I/O: both remain O(bytes).

`src/streaming-revision.ts` owns the file descriptor, decoder, hash and byte cap.
It validates optional limits exactly like readBoundedSource, checks the opened
file is regular, rejects initial oversize and growth after at most limit+1 bytes,
and always closes in finally. No default cap is added: unbounded revision guards
must still support shrinking/trashing oversized notes. EOF finalizes the decoder
before the digest; no partial digest is returned on failure.

`VaultIoCoordinator.readUtf8Revision` uses the existing adaptive scheduler and
separate in-flight key including operation, limit and path. Only concurrent
identical reads coalesce; no result is retained after settlement. Keep normal
content reads separate from digests and preserve expected-limit backpressure.

`FileSystemService` shares its existing normalization, resolved-path defenses,
PathFilter, directory check and error translation between body and revision
reads. Caller scope/moderation checks remain the caller's responsibility; a hash
is not an access grant. This does not make external concurrent edits atomic or
fix pre-existing path-resolution/open races. No runtime/config/live Vault edits.

## Evidence gates

- Observe existing readNoteRevision using whole-body reads in a failing test.
- Compare with the existing full-decode hash for empty/ASCII/BOM/CRLF/NUL/Korean/
  emoji, all split positions of multibyte characters at 64 KiB, invalid bytes and
  incomplete EOF sequences. Compare bounded/unbounded and repeat reads after edit.
- Real file-handle probes show one reused buffer <=64 KiB, growth limit+1,
  descriptor close on success/read error/size rejection. Directory/missing/denied
  paths retain error behavior. Coordinator tests cover dedup, cap isolation,
  shared concurrency and retry after failure.
- Build, targeted and full single-worker suites, independent review, diff check.
  Measure isolated large-fixture memory without live Vault/heap dumps, and report
  scope/limits instead of claiming a machine-wide speedup.

StringDecoder retains incomplete multibyte suffixes until write/end; this is why
it is used instead of independently decoding each buffer.
[Node StringDecoder](https://nodejs.org/api/string_decoder.html)
