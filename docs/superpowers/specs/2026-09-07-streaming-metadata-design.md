# Streaming metadata from one revision-bearing read

User approval is delegated; execute inline on the user's fork main. Do not
restart servers, edit live Vault data/configuration or add client installations.

## Problem and choice

`FileSystemService.readNoteMetadata` currently retains a complete decoded body
even when its result contains only Properties and revision. The prior parser
projection removes one Buffer copy, not this whole-file decoded allocation.

Reading just a header loses body-sensitive revisions. Reading a header and then
hashing separately risks pairing different file observations. Choose one opened
file, one decoded UTF-8 stream, one hash and a leading-header collector. Reuse
the existing <=64 KiB streaming reader, raw-byte limit/growth guard and finally
close. This is not filesystem snapshot isolation against external in-place edits;
it preserves the same-stream provenance of the old single read.

## Boundaries

- The collector preserves one optional BOM and the existing leading opener /
  first closing newline-plus-three-dashes rules. It buffers at most a partial
  opener and the header, discards bodies, and handles delimiter splits. Unclosed
  or huge headers still require their full text under the caller's byte limit.
- Hash every decoded chunk and final decoder suffix, including malformed UTF-8.
  Return only immutable header and revision strings, not shared mutable parsed
  Properties. Parse separately per service call with the data-only handler.
- Put projection reads into the same adaptive I/O coordinator and in-flight map
  with a distinct operation/path/limit key. Validate limits before JSON keys.
  Do not cache completed reads or bypass admission on the projection path.
- Keep metadata index fast-path, scope predicate before and after I/O, path
  normalization/filtering/resolution, strict error vs missing classification,
  500-path cap and case-folded dedup unchanged. No new MCP API or mutation.
- Keep full note readers unchanged. Metadata revisions still cover body bytes;
  no claim of fewer disk bytes, GPU acceleration or whole-process RAM ceiling.

## Proof required

An old-implementation RED test must show fresh metadata invokes whole-body
readers. Real temporary-file tests compare metadata/revision with the current
full parser across safe/malformed/unsupported headers, BOM, CRLF, chunk-split
delimiters and invalid UTF-8. Verify no mutable sharing, later edits/deletions,
scope revocation, byte caps, storage failure/close and in-flight separation.
Run build and all tests sequentially, one worker; independent integrity review.
Record memory experiment scope if performed. Commit generated dist alongside
source; publish only the user's fork and verify remote SHA. Overall Goal stays
active after this increment.
