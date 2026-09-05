# Visible bounded Vault statistics implementation plan

Inline TDD/executing-plans. Fork-main commits/pushes authorized; no new agents,
live Vault writes or server restarts.

## Design

Current getVaultStats counts filesystem entries without checking moderation.
Before contributing Markdown/txt entries to note/size/recent totals, read complete
bounded content through the existing VaultIoCoordinator and parse Properties.
Exclude hidden/quarantined/removed owners independently of folder. Keep allowed
non-Markdown files (Bases/Canvas/custom extensions) as file inventory, not factual
knowledge; explain the legacy notes label. Folders count caller-visible allowed
directories, including empty ones, independent of hidden file membership.

Resolve paths through the existing boundary checks. Confirmed missing files can
be omitted; other IO failures and oversized sources reject with generic errors,
not successful partial totals or physical-path disclosures. Source limits match
8 MiB supported writes. Counts are an advisory scan, never an atomic snapshot.
Fresh checks cost more than stat-only inventory; a separately cached index would
need freshness auditing and is not substituted merely for speed.

Validate recentCount as 0..20 (clamp higher valid counts), with 0 meaning no sample.
Public adapter maps recent paths to public scope URIs, then packs within maxChars
including pretty indentation. Drop whole recent entries, never clip identifiers;
mark sample truncation and preserve aggregate numbers. No new MCP tool or client
setup, and the recent sample is not an exhaustive pageable listing.

## Tasks

- [x] Add src/vault-statistics-visibility.test.ts: hidden totals/bytes/recency,
  fresh hide/unhide, scope predicate, zero/invalid count, public small pretty
  budgets, private-scope path projection and storage-failure behavior.
- [x] Repair FileSystemService.getVaultStats and public schema/adapter, preserving
  existing count/folder/size tests. Add success and bounded failure checks.
- [x] Update README/schema/roadmap, build/full suite, compiled isolated MCP smoke
  and diff-check. Commit source/generated dist and verify remote SHA separately.

## Evidence

- Four baseline regressions failed: hidden files contributed counts/bytes/recent,
  malformed recentCount was accepted, checked-path IO errors were bypassed, and
  public response compaction lost aggregate numbers at 512 characters.
- Six new tests now cover those cases plus allowed Canvas/empty-folder semantics
  and generic oversized-source rejection. Private authenticated recent paths are
  scope://model/codex/... rather than uncallable physical _scopes paths.
- Targeted: 184 passed, one skipped. Build succeeded. Full: 1149 passed, one
  skipped across 81 files, 55.19 seconds.
- Compiled MCP smoke: 20 public notes plus a hidden owner; <=512-character pretty
  response retained exact visible note/byte totals and marked dropped recent
  samples. Zero requested recent entries stayed empty. Unhiding an owner on disk
  increased the next count and updated recency. Client/server closed and only
  the validated owned fixture was removed. No live Vault edits/restarts.
- Inline review: samples are bounded after public path projection; count 0 and
  positive cap have matching service/adapter semantics. Aggregate byte sizes and
  mtime remain filesystem-scan observations, not a revision-coherent snapshot.
  Markdown source reading adds IO; no independent cached-health certificate or
  constant-cost inventory is claimed.
