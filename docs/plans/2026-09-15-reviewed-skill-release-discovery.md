---
id: reviewed-skill-discovery
description: Bounded approved procedural search using the same read authorization.
keywords: [skill search, reviewed procedures, quarantine, 검색, 승인]
use_when: Connecting reviewed releases to common search without factual-source confusion.
parent: 2026-09-15-reviewed-skill-release.md
previous: 2026-09-15-reviewed-skill-release-passport-work.md
next: 2026-09-15-reviewed-skill-release-host.md
---
# Reviewed procedure discovery

Use wiki.search resultKind=procedures for an explicit procedural card packet.
Default resultKind=notes keeps the existing array and ranking behavior.
Example: query="review", resultKind="procedures", limit=1, maxChars=4000.
Do not mix these cards with factual RetrievalHit paths or answer citations.
No new fixed MCP tool, host grant, installation or script execution.

## Bounds and authority

Read at most eight private registry directory entries, not the whole Vault.
Registrations are candidates, never approvals by themselves; fresh reader checks apply.
Verify actual account/runtime, source bundle ACL, owner read AND discover consent.
Validate manifest/evidence/descriptor/resources and final dispatch fences.
Return at most three complete-condition cards; obey a smaller requested limit.
Deduplicate IDs. Search actual functions/purpose/aliases/examples, not JSON keys.
Never expose source/host paths, hidden titles, rejected candidate counts or raw errors.
Keep original quarantine and raw-read denial; no fallback to mutable source versions.
Unsupported strict/scoped filters yield no recommendations rather than relaxed matches.
Below 1024 characters, return a short partial packet without candidate reads.

## Verification and remaining work

Target tests cover bounded registry reads, corruption/links, consent, current source,
forged identity, late revocation, Korean aliases, small budgets and MCP compatibility.
Static fixtures do not prove actual host connectivity or operating latency.
The eight-entry window is deliberately partial, not full-library discovery.
Remaining: paginated/indexed candidates, context_route integration and throughput tests.
The restricted diagnostic HTTP listener remains skill.resolve-only.
No live release or metadata finalization follows merely from these tests.
All prior full-regression receipts are historical after these source edits.

Current build passed; related targets: 236 tests / 27 files, zero failures.
RED covered absent discovery, metadata-key matching and ignored requested limit.
Architecture drift was reviewed before updating the pinned adapter/diagram hashes.
Full run d: exact current-basis coverage verified, 525 files / 7,068 passed / 4 skipped.
