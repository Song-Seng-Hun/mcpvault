# Graph moderation view

Execute inline using TDD and verification-before-completion; no new agents.
User authorizes fork-main implementation, commit and push only.

## Design

Graph links/tags/identity terms and moderation visibility must come from the
same parsed revision. Store a compact hidden flag in each graph entry and apply
it before constructing visible resolver paths, incoming edges, totals and pages.
Hidden notes must not prevent a visible note being an orphan. Outlinks must not
resolve solely to hidden targets; known invisible targets and explicit private
scope links are not unresolved repair tasks. This is an advisory caller-visible
graph, not a full-vault certificate or a file deletion authorization.

Filesystem direct source/target entry points retain fresh raw moderation checks.
Unindexed backlink/outlink/unresolved/orphan/tag fallbacks use a temporary graph with
finally-close rather than duplicate parsing/filtering implementations; indexed
production readers continue reusing their existing shared graph. Existing
backlink source rechecks remain. Shared view caches are invalidated by graph
generation changes; no access grant is derived from reputation or folder names.

## Tasks

- [x] Reproduce hidden tag/unresolved/orphan/outlink visibility through actual
  public MCP and direct graph; cover Knowledge and Community paths, limits/totals.
- [x] Test warm hide/unhide invalidation, alias resolution, hidden target denial
  and unindexed service parity with readable attachment targets.
- [x] Implement entry hidden flag, pre-count resolver filtering, consistent
  unresolved suppression and direct source checks; share fallback graph reads.
- [x] Review existing parsing tests, run targeted suites, build/full tests,
  compiled isolated-vault MCP smoke and diff check; update docs and include dist
  in fork-only delivery.

## Verification and review

- Initial eight regressions exposed hidden tags, repair candidates, orphan
  counts, hidden target access and unindexed parity. Follow-on regressions
  exposed neighboring/clipped reference leaks and synthetic Property line
  over-redaction; the final implementation covers all thirteen new cases.
- Fresh targeted run: 195 passed, 1 skipped across graph moderation, graph and
  filesystem suites. Fresh full run after descriptions/build: 1083 passed,
  1 skipped, 71 files (47.24 s). TypeScript build and diff check passed.
- Compiled `dist/src/createServer.js` with Client/InMemoryTransport and a real
  isolated vault: five fixed tools; public tags, backlinks, outlinks, unresolved
  links and orphans retain correct counts and bounded masked contexts. Fixture
  cleanup validated its owned absolute temporary path; live Vault untouched.
- Inline review retained fresh direct-note/source moderation checks, caller
  predicates and attachment behavior. Temporary fallback graphs use finally;
  injected production graphs remain borrowed. Shared entries are not redacted
  in place. Backlink fallback consolidation also removes its divergent parser.
- Source, generated dist, public endpoint descriptions, README, schema and
  roadmap are delivered together. No new endpoints or client installation.

## Limits

No claim that an OS watcher captures every concurrent external edit immediately.
Global graph snapshots, backing-source revision checks on every edge, tag body
fence parsing, vault-stat counters and global memory bounds need independent
audits. Do not delete or mutate notes to repair a derived graph.
