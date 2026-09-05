# Useful next actions within final response budgets

The whole dispatcher already enforces wire length. The defect was loss of
actionable data to generic compaction: nextActions could retain an oversized
single row and measured only compact JSON. Fix the service projection, not the
five-tool control plane, authorization, graph eligibility or ranking.

Implementation: a focused packet helper budgets the requested final JSON format.
Prefer full data when it fits, then ranked prefixes with exact paths/revisions
and source reads. Mark action previews and omissions explicitly. If the ranked
head cannot fit, reuse original request arguments with bounded overrides;
never skip it for a cheaper row and never repeat an identical ceiling retry.
Empty eligible sets retain exclusion counters when detail has to be omitted.
Source read revisions must be compared; neither recommendations nor retries
reserve work. No new client installation or live Vault changes are required.

Validation scope: service regression tests, prefix/order/budget matrix, existing
capacity/dependency ranking coverage, dynamic MCP formatting and useful payload,
build, full tests, compiled isolated MCP smoke, diff review and fork-only push.

Red evidence: six regression cases failed before production edits. A 512-char
service budget returned 40,462 compact / 40,609 pretty characters; long actions
had no preview flag; huge head identities had no recovery or ceiling failure;
an empty blocked set with a large requested context exceeded 10,000 characters.
These are service-return sizes, not actual MCP wire sizes.

Open audit: reviewDashboard's compact fallback still needs its own useful final
budget projection. This next-action fix does not claim that unrelated endpoint
is repaired, nor that the whole organization goal has been achieved.

## Verified result

- Targeted suite: 108 tests passed, including twelve dedicated budget cases
  and the final dynamic MCP response regression. Ranking ties, capacity gates
  and dependency exclusions remain covered by the existing suites.
- Build exited zero. Full suite exited zero: 1,286 passed, one skipped, 99
  files, 65.33 seconds. `git diff --check` passed.
- Compiled five-tool MCP smoke used a temporary Vault with a 20,000-character
  title, waiting work and an inaccessible other-model task. Compact response
  lengths were 269/527/527/527 for budgets 512/1200/7000/16000; pretty lengths
  were 391/734/734/734. Every response retained the correct action/path/revision;
  following notes.read matched its revision. Waiting and private work stayed
  excluded. Fixture client/server were closed and the validated temporary
  Vault/account removed; no live Vault mutation or server restart occurred.
- Inline review: packet construction only consumes already-authorized rows,
  preserves ranked prefixes and exact identities, omits access tokens from
  retry instructions, and keeps ranking/dependency services unchanged. No new
  endpoint, mutation, client daemon, or private data export was added.
