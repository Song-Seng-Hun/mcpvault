# Explicit note extension identity

## Proven problems

The plain Property relocation audit identified an unverified suffix-collision
boundary. New tests reproduced explicit `Target.md` resolving both `.md` and
`.markdown`, and delete impact confusing distinct physical sibling files.
Further red tests reproduced qualified `Target.md` selecting `Target.md.md`,
graph alias fallback for missing explicit filenames, and reference validation
stripping `.md` before resolution in indexed and fallback modes.

## Implementation

- Exact filename and exact qualified-path maps in the existing derived note
  reference index; no new persistent store, MCP tool, or client setup.
- Explicit known note suffixes do not fall through to other suffixes or aliases.
- Qualified virtual paths retain their mapping; extensionless ambiguity and
  dotted non-note aliases remain supported.
- Graph fallback matches the same explicit filename rule.
- Reference validation keeps the authored suffix.
- Move/delete compares full resolved physical identities, never extensionless
  stems. Different-extension siblings remain distinct referencing documents.
- Luna review found dot-segment input spellings could still bypass those
  comparisons. Red regressions reproduced ./ and in-vault ../ move/delete
  impact failures. Canonicalize move/delete input paths lexically before access
  checks, while retaining UNC syntax and unresolved leading traversal for
  existing safety checks. Added denied-scope, restricted-directory and
  out-of-vault tests. Reviewer closed after delivering its findings.

## Verification

Resolver, filesystem, graph and indexed/fallback review regressions added.
An integration test initially used a nonexistent path field from readNote;
correcting the fixture to use its explicit path made all 18 review tests pass.
All 232 targeted tests passed (one additional platform test skipped). Build
and diff check passed. Compiled service smoke passed exact suffix resolution,
reference validation, delete impact, canonical move, sibling preservation,
re-read and backlinks. Owned fixture removed. A full-suite regression required
preserving `./Note.md` in unrelated tag-operation responses; canonicalization
was scoped to note move/delete and their previews. Mutation-lock and filesystem
suites then passed (208 passed, 1 skipped).

Final full suite: 1363 passed, 1 skipped, 102 files (59.51 seconds). Final build
and diff check passed. Rebuilt service smoke reconfirmed exact suffix identity,
canonical move/delete impact, sibling preservation/backlinks and unchanged
tag-operation response spelling. Owned temporary fixture removed.

## Limits

This is not a complete CommonMark parser or a filesystem case-sensitivity
redesign. Relative lookup, aliases without note suffixes, bounded projections,
scope filtering and revision checks keep their existing contracts. Original
Markdown/Git remains authoritative; no live Vault data is changed.
