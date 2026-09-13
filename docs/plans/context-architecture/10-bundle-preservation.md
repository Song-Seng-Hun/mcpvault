---
id: context-bundle-preservation
kind: implementation-record
description: Private original preservation before chapter generation; not migration approval.
keywords: [bundle, original, revision, restart, 원본, 복구]
parent: README.md
previous: 09-librarian-preflight.md
next: 11-bundle-review.md
---
# Bundle preservation — P1b

Use for an explicitly admitted ordinary Markdown document. No Vault writes yet.
Do not use for managed records, source ingestion, translation or cutover.

## Contract

- Existing compilation projects need a separate `chapterBundles` grant.
- Each grant pins `documentPath`, UUID `documentId`, and exact `chapterRoot`.
- The document must already occur in the project's resolved source policies.
- No grant: diagnosis only. `source_only`: index runtime only, no synthesis.
- Runtime, actor, document restrictions and input revision are rechecked.
- Private host records preserve request binding, manifest and exact UTF-8 bytes.
- The manifest precedes source bytes; hash reread precedes `source_preserved`.
- Current source reads are limited to512KiB; larger documents need later paging.
- Prepared, preserved and eventually completed are separate states.
- This release never marks a preserved source as a completed conversion.
- Records are bounded private files; existing single-output history is untouched.
- Interrupted attempts resume through `prepare`; at most3 capture attempts.
- Corrupt history, reused request IDs and changed grants are never reset.

## API example

Use `call_endpoint` with endpointId `wiki.compilation`; fixed tools stay unchanged.
Prepare arguments (source revision must come from an actual current read):
```json
{"kind":"document_bundle","op":"prepare","projectId":"p","requestId":"capture-1","documentPath":"Manual.md","expectedDocumentRevision":"<sha256>"}
```
Read `bundleId` with `op:read`; use `projection:original` and `expectedJobRevision`.
Original reads need at least1024chars; follow returned Unicode-safe continuation.
Historical originals keep their own source revision, never the current revision.
Read-only servers permit reads; prepare/submit/check/retry mutations remain denied.

## Work checklist

- [x] Private page storage, explicit grants, source preservation and MCP read path.
- [x] Initial targets: restart, corruption, source-only, request and policy drift.
- [x] Final targets, build, frozen full suite, solo review and NAS verification.
- [x] Commit/push6db3a78a to existing main in the user fork.
- [ ] Candidate submission, semantic checks, hidden staging and actual cutover.
- [ ] Language profile, P2-P5, real inference and context-cost evaluation.
