---
id: reviewed-skill-release-inventory
description: Actual library inventory, source-matched drafts and unresolved provenance.
keywords: [skill inventory, source hashes, metadata, truncated procedure, 감사]
use_when: Resuming actual library review; not approval or an executable instruction.
previous: 2026-09-15-reviewed-skill-release-progress.md
next: 2026-09-15-reviewed-skill-release.md
---
# Inventory evidence

Fresh enumeration: 1,610 targets, 1,605 canonical IDs, no added/absent names.
Noncanonical IDs stay in review; do not silently drop or merge them.
Initial byte scan: 1,605 complete, five timed-out; 8,926 recorded files, 124,885,905 bytes.
Enumeration and scanner basis stayed stable; this is not an atomic NAS snapshot.
Host-only evidence folder: .mcpvault/skill-reviewed-release-20260915/.
Source journal: source-inventories.jsonl; terminal receipt: inventory-result.json.
Initial scanner SHA: fb718bd6339488725c61410459bf3f342d0346932054a514e026832520fea60a.
Gaps: automate-faceless-content, book-genesis-studio, python-upwork, vercel-optimize, vina.
One unchanged-limit retry finished: python-upwork complete; four still time-limited.
Receipt: inventory-gap-retry-result.json preserves that 1,606-complete intermediate state.
Measured redundant ancestor realpath calls; retain every lstat check, resolve once per path.
New scanner SHA: 91178951a115507fba5695c2d6a3b0b50f7473b26bb06f7bc448e5a8c06844fe.
inventory-optimized-gaps-result.json: remaining four complete; all 1,610 now snapshotted.
No larger time/byte limits; before 30s timeout, after 11.3s complete for the profiled bundle.

## Source-matched metadata drafts

doc-coauthoring, receiving-code-review, requesting-code-review: metadata-three-evidence.json.
writing-plans, executing-plans, verification-before-completion, hybrid-search-implementation:
metadata-four-evidence-v2.json records exact source hashes, lines and main review corrections.
Its 21 remaining delegate quote differences were CRLF representation, not missing facts.
Earlier draft revisions remain distinct; never reuse their apparent quote matches.
Ten source-matched drafts; finalized metadata and actually usable releases remain zero.
Two Luna sidecars finished; main independently read all ten files across seven bundles.
Third sidecar: three drafts/39 files; metadata-security-three-evidence.json now validated.
Three normal and four adversarial scenarios per latter four are fixed, not executed.

## Review findings

Some NAS entries are truncated and advertise nonexistent scripts/run.sh.
Hybrid templates contain unsafe SQL key construction, positional parameter collision,
missing filtered RRF coverage, and incomplete code; no template execution is approved.
Fuller local counterparts differ in hashes and local- IDs; names do not establish identity.
Receiving/requesting/verification local import records reference retained MIT evidence.
That local provenance does not establish exact NAS ancestry; doc-coauthoring needs more work.
No NAS restoration/write or release. [First candidate](2026-09-15-reviewed-skill-release-canary.md).
