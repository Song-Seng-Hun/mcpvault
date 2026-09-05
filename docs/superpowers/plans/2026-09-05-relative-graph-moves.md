# Relative graph and move parity

## Evidence and implementation

Follow-up to relative-review-links: four red tests showed that stripping ./
in the occurrence parser created spurious backlinks to same-name notes,
false ambiguity during target moves, and missing outgoing wikilink rewrites
during source moves. A fifth red test proved missing explicit ./ paths fell
back to an unrelated basename in the shared resolver.

- Preserve authored relative prefixes in occurrence targets.
- Pass sourcePath into move wikilink resolution, for body and Properties.
- Rewrite a moved source's explicit relative outgoing wikilinks as qualified
  target links while retaining heading/block/alias syntax.
- Stop explicit missing relative references before global-name fallback.
- Leave bare-name ambiguity, revision checks, scope/path filtering, literal
  fence masking, and authoritative Markdown/Git unchanged.

## Verification scope

Tests exercise parser locators, graph duplicate names, hidden-target exclusion,
cache invalidation after source edits, missing-target non-fallback, move
previews, actual inbound rewrites, outgoing body/typed-Property rewrites,
and preservation of fenced examples. Existing concurrency and failure tests
remain part of the full suite. No production Vault is used.

## Remaining audit

Ordinary Markdown destinations such as `(Sibling.md)` without ./ still have
different source-relative treatment across graph, reference and move readers.
Plain Property path values without wikilink syntax also need a separate move
parity audit. Moving a source whose relative links were already unresolved
also needs an explicit policy to prevent accidental rebinding at its new
location. This batch does not claim those semantics are unified.

## Results

- Focused suites: 222 passed, 1 skipped before the additional cache-refresh
  assertions; final full suite includes those assertions.
- Build and diff check passed. Final full suite: 1334 passed, 1 skipped,
  102 files, 57.77 seconds.
- Compiled FileSystemService smoke verified source move preview, body and
  Properties rewrites, retained block/alias, correct backlinks before/after,
  and stale revision rejection without changing the source. Owned temporary
  Vaults were removed. The first harness expected a thrown revision error;
  it was corrected to the service's documented success:false result shape.
- Luna found no introduced defect, and identified missing direct ../ outgoing
  move coverage. The source-move regression now runs from both sibling and
  child folders and includes typed-Property block/alias suffixes. Both cases
  and the final full suite passed. Reviewer closed after delivering findings.
