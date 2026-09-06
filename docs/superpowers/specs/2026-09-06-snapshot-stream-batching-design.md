# Bounded snapshot batching and IO verification

The user has delegated design approval within the active Goal. This increment
addresses resource efficiency without new client setup or live Vault changes.

## Choice

Keep gzip JSON and the existing atomic writer. Coalesce small records into
owned buffers of at most 64 KiB before compression. Compared with unbatched
streaming this reduces codec writes; compared with whole-payload concatenation
it retains bounded read-ahead. Worker/GPU offload is not justified for this IO
path and would add orchestration and memory cost.

## Contract

- A lazy byte-chunk generator checks the cumulative decoded ceiling before
  encoding each record, copies into bounded output buffers, and preserves exact
  UTF-8 bytes, including split byte chunks and replacement of unpaired surrogates
  exactly as Buffer.from on each input string. Never reuse emitted buffers.
- The stream still applies the compressed ceiling, exclusive temp creation,
  closed-before-rename publication, bounded transient retry and owned cleanup.
- Cancellation closes the underlying iterator. Excessively large input records
  fail before allocation of their encoded bytes. Accepted records can still
  require their individual encoded Buffer: not constant-memory whole indexing.
- Verify actual gzip bytes and complete target publication, not mock returns.
  Instrument real IO only to inject retry codes or hold the destination corked.
- Test rename retry schedule 10/30/100 ms, exhaustion and nontransient failures,
  plus limited read-ahead while a real destination is stalled.
- Deterministic operation counts prove batching; do not infer RSS or production
  speed percentages. Current captured semantic inventory remains O(N).

Node documents highWaterMark as a threshold, not a hard memory cap, and async
zlib as threadpool work. Explicit chunk bounds and backpressure are therefore
both needed: https://nodejs.org/api/stream.html#buffering and
https://nodejs.org/api/zlib.html#threadpool-usage-and-performance-considerations.

## Verification and authority

Unit RED/GREEN for batching, real gzip/file integration and IO fault tests,
targeted semantic tests, build, one-worker full suite, independent review and
diff check. Only source/tests/docs/generated dist go to the user's fork main.
No endpoint or permission/schema changes, server restart, model download, or
upstream contribution. This does not complete the broader organization Goal.
