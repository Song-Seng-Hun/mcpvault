# Distinct MOC proposal destinations

## Problem and authority

Candidate domains A/B and A:B become the same A-B.md destination. Rebalance
group labels have the same lossy sanitization/truncation. Independent accepted
proposals must not compete for a single note. User delegated design approval
and fork-main implementation; no live Vault changes or upstream contribution.

## Design

Allocate destination paths over all groups already admitted to the bounded
request, before branch/candidate output limits. Keep non-colliding paths
unchanged. Compare normalized physical paths case-insensitively. For collisions
append a short SHA-256 suffix derived from the full group identity, not its
lossy filename. Reserve every original path first; if a generated suffix also
collides, append a deterministic counter in identity-sorted order. Allocation
does not inspect extra files, persist a registry, or alter group membership.

Both mocCandidates and mocRebalance use one pure helper. The resulting physical
path drives access checks, collision reads, public path, draft relative links,
and any creation action. Mark changed destinations pathDisambiguated:true.
Existing destinations still lead to bounded reads, hidden ones remain invisible,
and absent destinations retain expectedRevision:missing. No overwrite permission
is added. A new request with a different admitted group set may produce new
suggestions; these are advisory paths, not durable IDs or cross-request locks.

## Alternatives

Rejecting colliding proposals loses useful organization work. Random UUIDs make
repeated previews diverge. Deterministic suffixes keep recognizable names and
bounded computation without a registry or extra client setup.

## Proof required

Real temporary-Vault tests reproduce duplicate candidate and rebalance paths,
including long-label truncation and same title across grouping kinds. Assert
unique case-folded paths, stable output-limit behavior, correct creation action
paths, no writes during previews, scope isolation, and existing-destination
handling. Pure helper tests cover input reordering and suffix-shaped natural
names. Run focused tests, build, full one-worker suite, independent review and
diff checks. Publish only explicit source/test/docs/dist files to the user fork.
