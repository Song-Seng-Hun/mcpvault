# Query-local graph excerpt reuse implementation plan

> Execute inline with executing-plans/TDD. No agents, live Vault writes, new MCP tools, or upstream contributions.

**Goal:** Dense graph fingerprint scans reuse identical redaction work without sharing caller-specific content or changing exact link locators.

**Architecture:** Extract the existing graph link projector into a focused helper. Bind one invisible-target predicate to one query and keep entry identity, line and original context/heading in memoization keys. Cache context templates, not a first link's fallback string. Keep at most 256 entries and 64 Ki characters of key/value text per projector; oversized entries bypass caching. Entries are evicted normally; correctness never depends on cache retention. Parsed graph objects stay immutable.

**Tech stack:** TypeScript, existing Obsidian parser, Vitest operation-count instrumentation and compiled MCP fixture.

## Design review

Global memoization would need permission/revision keys and invalidation machinery.
Unbounded query-local caching would retain large scans. Choose bounded ephemeral
reuse. The existing hidden-line index remains scoped to each source entry and
the resolver pair remains fixed for the query. This reduces repeated work for
identical text, not total graph traversal, large uncached headings, or all source
IO. Preserve synthetic Property contexts sharing a line number as distinct keys.

## Tasks

- [x] Instrument real parser/redaction calls in a dense graph query; prove the
  same heading/context is processed per link before improvement. Assert exact
  visible output and absence of hidden references, not elapsed-time thresholds.
- [x] Add regression coverage for partial-hidden-context templates with distinct
  own links, opposite visibility predicates, and different Properties on line 0.
- [x] Implement the extracted bounded projector, wire the existing graph method,
  and test cache entry/character eviction through real operation counters.
- [x] Verify targeted tests, build, full suite, diff check and compiled dense
  navigation. Document bounded reuse and remaining cost limits.
- [ ] Commit source/tests/docs/dist and push only the authorized fork main.

Commands: `npm test -- src/graph-moderation-view.test.ts src/graph-link-projection.test.ts src/navigation-view.test.ts`, `npm run build`, `npm test`, `git diff --check`.

## Evidence and inline review

- Baseline dense fixture failed: one heading parsed 601 times. After reuse,
  the same real parser runs once and the context/heading replacement runs no
  more than twice; output counts, locators and masking are unchanged.
- Targeted: 31 tests passed. Full regression: 1206 passed, one skipped, 88 files
  (62.18 seconds). Build and whitespace checks passed.
- Compiled MCP fixture: 600 incoming links, bounded 3000-character responses,
  no hidden alias in returned headings/context, unchanged fingerprint across
  guarded pages, five stable tools. Owned temporary fixture removed.
- Inline review checked original redaction-loop equivalence, partial-link
  fallback templates, distinct Property contexts at synthetic line numbers,
  same-path replacement entry identity, opposite visibility predicates, and
  LRU entry/character eviction. No stored graph mutation or cross-query cache.
- Limits apply to retained preview keys/values, not the existing hidden-line
  index, parser inputs, total source IO, or oversized uncached computation.
