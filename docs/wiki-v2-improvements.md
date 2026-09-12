# Evidence retrieval and bounded maintenance

## Optional evidence retrieval

`wiki.answer_packet` accepts `retrievalMode: "legacy" | "evidence"` with a
`query`. Omission preserves legacy behavior, including path-only packets. The
option does not enable inference, configure a provider or grant document access.
Use `includeSemantic: false` for a deterministic lexical-only query.

Evidence mode combines existing lexical and admitted semantic ranks with
equal-weight reciprocal rank fusion (`k=60`, at most 20 candidates per channel).
Repeated hits within a channel do not add votes. An unavailable semantic backend
leaves lexical results. Exact phrases, exclusions and structured filters retain
the existing strict engine and do not expand through semantic or graph results.

Current source revisions, authority, moderation and original evidence are checked
after candidate selection. One-hop explicit relations and incoming contradictions
are navigation, not proof. Existing shared-source ancestry groups remain advisory;
multiple summaries of one work are not independent confirmation. An exact
semantic source anchor can supply a passage when translated/paraphrased query
terms do not occur literally. A rank never certifies that a passage answers a
question.

Evidence packets drop display metadata before complete source units and prioritize
counterpoints and original sources over leads. Omitted counterpoints produce a
specific gap and revision-guarded continuation. The complete serialized response
still fits `maxChars`; callers must follow `partial` and gap signals rather than
interpret a short packet as complete knowledge.

The default remains legacy unless the fixed bilingual/mixed evaluation meets
the approved quality gates at equal response budgets. Character counts are not
model tokens, lexical fixtures are not real-inference quality measurements, and
local I/O is not measured NAS traffic.

## Maintenance delivery

`wiki.exception_board` defaults to compact `groups`, ordered by access/integrity,
evidence/conflicts, navigation, then cleanup. `grouped: false` retains the legacy
flat `items` view. Groups contain current revisions, rule-bound issue IDs,
affected visible evidence and an executable read action. Counts are not a Vault
health certificate. Follow `retry` when a complete group cannot fit the budget.

To defer a reviewed group, use existing revision-safe `notes.change_set` to store
its `reviewBasis` as `maintenance_review_basis` alongside `review_snoozed_until`.
Changed or incomplete evidence invalidates that deferral. A successful review or
edit is not proof of repair: only a subsequent successful diagnostic removes the
finding. No automatic truth/confidence score or lifecycle change is introduced.

Automatic work is off unless the host starts with `--maintenance-config` pointing
to an existing ACL-private local file outside both Vault and source repository.
The configuration names `version: 1`, `enabled`, the exact canonical `vaultPath`,
an existing `accountId`, exact Vault-relative `paths`, and `operations` selected
from `cache_refresh`, `managed_canvas_regenerate`, `moved_link_repair`. Wildcards,
model names and feature selections never grant execution authority. Read-only
startup ignores automatic maintenance. Deployment does not create an allowlist.

The single worker uses current account/write capability, moderation, document
policy and a private writer lease. It rechecks approval and revisions at physical
write dispatch. Protected/classified derivatives stay manual in this release;
they are not copied into shared caches or silently declassified. Cache refresh
uses existing lexical/metadata/graph indexes; it makes no model calls. Only
already-managed, source-stale Canvas files may be regenerated.

Move repair requires an exact successful host-captured non-overwriting move,
explicit source revision, unchanged destination/reference and un-reused old path.
It replays existing link planning through a one-note change-set preview and
fingerprint confirmation, preserving aliases, anchors and fenced examples.
External/ambiguous events (including an indistinguishable watcher echo), restart
observation gaps, incomplete captures and changed data remain for review. Current
path absence alone cannot prove historical non-reuse.

Private receipts retain exact before/planned bytes before a write, then verify
the resulting revision. Duplicate events do not repeat verified work; three
failures stop a job. Initial bounds are 64 jobs and 4 MiB of private state, with
no automatic history deletion or lock stealing. Full/corrupt storage requires
host review; it does not authorize dropping recovery data. The existing catalog
and reconciliation path supply events; no additional watcher or notifications
are introduced. NAS direct-write protection and Telnet remain outside this work.

Separate package validation, deployment and fork commits are recorded in
`docs/plans/2026-09-12-wiki-v2-execution.md`.
