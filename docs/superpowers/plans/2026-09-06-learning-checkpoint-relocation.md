# Learning checkpoint and scoped snapshot relocation

## Requirement

Organizing a Vault must not strand saved learning progress or revision-checked
pending work. Retain exact file identity across same-scope moves without
certifying historical work or disclosing private referring notes.

## Changes

- Recognize only producer-defined learning_progress root_path,
  completed_through, and entries[].path slots as captured identities.
- Include these paths in move/delete impact, not live graph navigation.
- Preserve Global/model/agent and server-local Community snapshot URI spelling.
  Inject the existing command-center scope policy into FileSystemService;
  register only this center's Community qualified paths. Foreign Community
  and host-only User URIs are not local references.
- Reject scoped checkpoint namespace changes, including Global to _whispers.
- Keep a same-namespace synthetic delete target and do not skip real notes
  that happen to match its name during read-only impact scans.
- Preserve every captured revision/fingerprint. A real MOC rename leaves
  progress stale but supplies a callable recovery path at the new root.
- Fail closed with a path-free error for malformed supported scoped metadata.
  Hidden referring paths remain undisclosed.

## Verification

- Learning and private scoped checkpoint delete-impact regressions initially
  found zero references; current targeted tests count and rewrite exact slots.
- Local Community alias test initially failed; explicit qualified alias fixes
  it while preserving a foreign center's identical logical path.
- Fresh regressions reproduced Global-to-whispers invalid URI generation and
  a hidden malformed URI being echoed in parse errors; both fixed.
- Targeted filesystem/continuity/property tests: 217 passed, 1 skipped.
- Build and final diff check passed. Full suite: 1381 passed, 1 skipped,
  103 files (69.61 seconds).
- Compiled-service smoke verified actual MOC save/move/resume, unchanged
  fingerprints and a usable stale-progress recovery path, plus local/foreign
  Community identity separation. Owned temporary Vault removed afterward.
- Existing Sol reviewer confirmed the malformed-URI and _whispers findings;
  both are fixed and covered by the passing targeted/full suites. No additional
  local Community mapping issue reported. Reviewer closed, not replaced with
  a redundant model run; future delegation uses expected total completion cost.

No new client setup, MCP tools, automatic scope migration or live Vault writes.
