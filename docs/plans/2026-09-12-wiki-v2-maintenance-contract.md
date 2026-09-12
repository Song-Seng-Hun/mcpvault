# Wiki v2 maintenance implementation contract

Package B of the approved plan. Design notes, not shipped/live verification.
Implement only after package A's separate delivery gate. Keep the fixed five
MCP tools, current branch, authoritative Markdown, and NAS/Telnet boundaries.

## Component boundaries

- `exception-board` remains the bounded public projection. A maintenance review
  service supplies grouped document issues, fixed priority tiers, rule versions,
  dependency revisions, and review state. Existing issue-oriented callers remain
  supported; grouped display does not imply a whole-Vault health certificate.
- Reuse existing `review_basis_content_sha256`, link/upstream review snapshots,
  snooze Properties and revision-safe changes. Neither a review outcome nor a
  successful write resolves a still-failing check. Unverifiable dependencies
  invalidate a snooze/completion claim rather than extending its lifetime.
- A separate host maintenance service owns the serialized queue and durable
  receipts. Host configuration is outside the Vault/source and ACL-verified.
  Missing/disabled configuration means no autonomous writes or new model calls.
- Filesystem move planning is reused to capture exact resolved references before
  a host-observed successful move. No filename/title/alias similarity inference.
  The recovery worker consumes only completed host receipts, not client-supplied
  histories, note Properties, filesystem rename guesses, or remote manifests.

## Host authorization and lifecycle

Configuration must explicitly name the Vault, current execution account, exact
allowed paths, and allowed operations. Keep operations limited to derived cache
refresh, managed Canvas regeneration and verified moved-link repair. A host allow
list intersects current account capabilities, document/scope authority, PathFilter,
ordinary-knowledge checks and original immutability; it never replaces them.

Reload/revalidate before each job and before every physical write. The queue has
one worker, one affected document per transaction, bounded admission and receipts,
event coalescing, and a stop state after repeated failure. Subscribe to the existing
catalog change batches and reconciliation path; do not add a second filesystem
watcher, unbounded polling loop, or model wake-up mechanism.

Persist intent and recovery data before mutation, then verify the resulting exact
revision before recording success. A restart with an interrupted job must compare
the current old/planned revisions and preserve unrelated user edits. If historical
path non-reuse or observation coverage cannot be established, retain the receipt
for review; do not silently promote uncertain history into execution permission.
Repeated unchanged events must not cause further edits or repeated notifications.

## Move receipt and application requirements

Capture old/new exact paths and before/after revisions, caller identity, and the
existing move planner's uniquely resolved inbound references. Reject incomplete,
ambiguous, hidden, protected, oversized, overwritten-destination or conflicting
histories. Bound captured source text and store it only in verified host-private
recovery storage. A failed move never produces a successful recovery receipt.

For each reference, require an unchanged destination, an unused old path, an
unchanged referencing note, and preserved alias/heading/block suffixes. Code-fenced
examples are excluded by the existing parser. Apply only the planner's exact link
changes through one-note `notes.change_set` business logic, with dry run,
fingerprint confirmation, current revisions and same-target reread. Never invent
a replacement target or resolve a collision from title/similarity.

No automatic body synthesis, claim promotion, contradiction resolution, lifecycle
transition, merge, deletion, or upstream publication is allowed. User-authored
Canvas files are not repair candidates. Regenerating a managed Canvas replays its
current `wiki.canvas_view` export action and output/source snapshot guards.

### Bounded initial implementation surface

- Host operation IDs: `cache_refresh`, `managed_canvas_regenerate`,
  `moved_link_repair`. Exact path entries, not wildcards or inferred roots.
- Review records expose separate `issueId` (rule + observed revisions) and
  `reviewBasis` (review-relevant content/Properties + current dependency revisions).
  A snooze stores `maintenance_review_basis` alongside the existing
  `review_snoozed_until` using the existing revision-safe change tool. Exclude only
  review bookkeeping from the basis to avoid self-invalidating that write. The
  issue ID still changes with the actual file revision.
- Start automatic link repair with completed, non-overwriting `notes.move`
  receipts for ordinary knowledge, not inferred external moves. If the move
  already updated links, there is no recovery job. Unrecorded service/internal
  moves retain existing behavior but grant no automatic recovery authority.
- Capture bounded exact before/planned bytes through the existing move planner;
  reject ambiguous/inaccessible/incomplete plans. One-note change sets also guard
  old-path absence and the unchanged destination revision. Preserve any partial
  failure for inspection and never apply a new patch on top of user edits.
- A restarted worker may verify already-written expected output, but an unapplied
  move across an observation gap is review-required. This conservative boundary
  is intentional: current path absence cannot prove historical non-reuse.
- Extend the existing change-set service with a trusted-only related-revision
  guard policy (not a new client payload permission). Lock source/destination and
  reference identities in stable order, bind guards to the preview fingerprint,
  recheck authorization and reference revision after awaited preparation at write
  dispatch. Preserve user edits during any rollback. Default unguarded callers
  retain their current contract.
- Runtime authority must use a fresh account lookup, not a cached principal list
  or the original move request's session. Reuse current moderation, capability,
  enterprise storage and document-boundary checks. An existing account ID in the
  private configuration is a requested execution identity, not a new account.
- Capturing a move plan and observing the successful move must share the
  filesystem's source/destination mutation locks. The existing non-link-updating
  move path does not itself compare `expectedRevision`; a recovery capture must
  independently require the exact before revision and verify unchanged moved
  bytes. A failed capture may leave ordinary move behavior unchanged, but must
  not produce a successful automatic-repair receipt.

## Required tests and acceptance

Use isolated temporary Vaults and private host fixtures, not live content, for:

- grouping, priority tiers, deterministic rule/revision identifiers, hidden
  dependencies, changed/snoozed issues and bounded complete JSON;
- absent/revoked configuration, current account/document denial and originals;
- successful versus failed/external/incomplete move histories; path reuse,
  same-name files, altered destination/reference and anchor/fence preservation;
- concurrent events, repeated unchanged events, restart, interrupted receipt,
  partial write and refusal to overwrite a later user edit;
- cache reconstruction and managed/unmanaged Canvas discrimination, existing NAS
  reconciliation compatibility and no new model/network execution.

Run targeted tests, build, all tests, two-stage independent reviews and staging
checks. Deploy as a separate preserved runtime and verify read-only live behavior,
canonical data hashes and disabled automatic execution unless a real host allow
list has separately been configured. Commit source and dist together and push the
user fork's existing branch. Missing operational enablement is not a license to
invent an allow list.
