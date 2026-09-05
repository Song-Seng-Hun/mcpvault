# Learning revision validation without repeated parsing

## Evidence and scope

The existing learning snapshot checks re-read each selected source and the
root with `readNote`, although the final stage only needs revision equality.
A real indexed and unindexed fixture (12 entries, one shared prerequisite,
one root) demonstrated 14 unnecessary FrontmatterHandler.parse calls after
metadata capture. The new no-reparse assertion failed in both modes.

## Repair

- Share the existing normalized, PathFilter-checked, symlink-resolved note
  reader and file errors between `readNote` and `readNoteRevision`.
- Keep VaultIoCoordinator backpressure/in-flight deduplication and the exact
  SHA-256 of decoded UTF-8. No stat-based equality or persistent hash cache.
- Use hash-only reads for final learning source/root checks, not for initial
  visibility classification or nested MOC traversal. An expected revision
  must come from a previously parsed, visible source. Any moderation change
  changes the hash. Recheck caller scope after the asynchronous source read.
- Retain batches of four, selected-source deduplication, generic source error,
  and rejection before replacing a saved learning checkpoint.

No MCP endpoint, client setup, schema, or live Vault change is required. This
reduces parsing work, not bytes read or the number of source reads. It remains
observed-drift detection, not an atomic whole-Vault snapshot. Total source
fan-out and initial discovery costs documented in the snapshot plan remain.

## Validation

- Red: indexed/unindexed fixtures each reported 14 parse calls, expected zero.
- Green: 33 targeted tests pass, including all prior five race scenarios for
  public reads and checkpoint replacement, bounded concurrency and deduplication.
- Revision-only tests cover empty content, Korean/emoji/BOM/CRLF, malformed
  YAML, invalid UTF-8, equal-size edits with restored mtime, path filtering,
  traversal, directory and missing-file errors; no parsing on hash-only reads.
- Astra's scoped review found no blockers. Added its suggested root-only
  hidden/revised races (public and checkpoint replacement), one final root
  read assertion, and access revocation during an asynchronous leaf/root
  read. These targeted snapshot/revision suites pass all 20 tests.
- Compiled dynamic MCP smoke verified a normal path, rejection of a leaf
  hidden after metadata capture without leaking its marker, and exactly five
  public tools. Its owned temporary Vault/account was removed; reviewer closed.
- Final build passed; expanded full suite: 1426 passed, 1 skipped, 107 files
  (72.17 seconds). Final diff check passed.
