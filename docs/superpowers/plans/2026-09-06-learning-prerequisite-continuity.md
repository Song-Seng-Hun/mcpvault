# Preserve prerequisite provenance across learning sessions

## Reproduced gap

LearningPath revalidated current external prerequisite revisions, but its
checkpoint projection omitted them. Continuity fingerprinted only the root
and authored entries, so edits outside the reading list could falsely resume
as ready. Real Vault tests reproduced ten false-ready cases: revised, hidden,
deleted, newly resolved, or newly ambiguous external prerequisites, in both
authored and recommended order.

## Repair and compatibility

- The internal checkpoint projection carries a SHA-256 over sorted visible
  captured source identities/revisions and the sequential hash of each scanned
  prerequisite's resolution cardinality/unique target, with a versioned payload.
  Candidate lists are not retained; ambiguous candidate order is irrelevant.
- Save requires the digest, stores one 64-character source_revision_fingerprint,
  and includes it in the overall revision fingerprint. No extra paths/bodies,
  endpoints, client setup, external services, or reading entries are added.
- Resume compares source snapshots, reports a sourceSnapshotChanged flag, and
  returns stale with no next read on drift. Missing legacy snapshots require
  recapture; malformed snapshots are invalid, never ready. Validation is read-only.
- Scope filtering and source revalidation precede hashing. Unrelated/private
  candidates do not perturb the digest. Existing non-atomic and bounded-scan
  limitations remain; this is not a transitive whole-Vault dependency proof.

## Validation

- Red: ten stale external-source scenarios returned ready, and two digest/
  legacy tests failed before implementation.
- Green: 47 targeted tests pass across continuity and learning integrity suites.
- Astra review identified shared-source ambiguity masking and array-to-string
  digest coercion. Both were reproduced with four failing tests, then fixed.
  Missing/malformed builder snapshots cannot replace existing work; malformed
  stored snapshots are rejected. Reverse metadata enumeration gives the same
  digest. Expanded source-checkpoint + continuity suites: 31 passed.
- Initial full suite passed 1438 tests (one skipped). Compiled MCP verified
  save/ready, external source edit/stale, no next read, unchanged checkpoint,
  and five tools. The temporary Vault/account was removed; reviewer closed.
- Final build passed. Updated compiled MCP smoke also reproduced the shared
  source ambiguity case: unchanged reading entries became stale with no next
  read and no checkpoint rewrite. Its temporary Vault/account was removed.
- Final expanded full suite: 1446 passed, 1 skipped, 108 files (72.64 seconds).
  Final diff check passed. Live Vault data and client settings were untouched.
