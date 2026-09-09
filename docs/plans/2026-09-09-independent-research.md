# Independent research before collaborative review

Status: the independent-research implementation was deployed on 2026-09-09 after
NAS cutover, at the user's request. Existing subject groups/temporary teams remain
unchanged. Protocol tests, static security review, NAS guidance sync and the current
Codex connection are verified. A subsequent two-session controlled model pilot
found equal final rubric scores, not general effectiveness; see
`../research/independent-timing-pilot-20260909.md` for results and limitations.
See `../independent-research.md` for the endpoint contract and
`../independent-research-validation.md` for evidence and remaining limits.

## Goal and evidence

Keep persistent subject groups open to collaboration while allowing selected
research tasks to gather evidence without reading peers' premature conclusions.
Coordinate scope, constraints, safety and budgets early; defer hypothesis sharing.

Reference: ArcticSwarm, https://arxiv.org/html/2609.01870v1 (sections 3, 5, F).
The paper reports 82.6% on BrowseComp-Plus/Qwen 3.5-27B, 78.8% without isolation,
74.5% without isolation and review, and 63.5% for 40 MiroFlow-single majority
votes. These are authors' benchmark results, not measured MCPVault improvements.
Isolation is per task and may be opened later, not only a global initial phase.

## Proposed contract

- Ordinary tasks keep open collaboration. Independent research is opt-in for a
  bounded research round attached to existing Work/Workshop records.
- Participants receive the question, neutral constraints, approved common
  sources and resource budget, not an asserted leading answer.
- Independent submissions record candidates, exact evidence locators/revisions,
  tested conditions, failed searches and uncertainties. Submission snapshots
  remain attributable; post-review revisions explain adopted/rejected evidence.
- Separate independent alternative search from criticism of a known candidate.
  A fresh independent task may be requested during review.
- A round proceeds through independent search, submitted evidence, authorized
  disclosure, challenge/alternative review, and synthesis or unresolved closure.
- Budget expiry does not manufacture approval, evidence or participant activity.
  Votes, likes, model labels and multiple roles on one account prove no truth or
  statistical independence. Preserve unresolved dissent and reconsideration cues.
- No automatic model spawning, new database, extra client or constant polling.
  Reuse existing five MCP tools, task claims, WIP, revisions and review services.

## Implementation boundaries and order

- [x] Define finite round/participant states and authenticated read rules in a
  focused service, before adding UI or policy claims of enforced isolation.
- [x] Extend existing Workshop/Work routes rather than duplicate their CRUD.
  Ordinary facilitation steps and contributions remain public guidance, not an
  embargo. Only the dedicated research-round route enforces pre-disclosure reads.
- [x] Implement a common visibility restriction for round artifacts, intersected
  with existing scope permissions. Cover direct note reads, search, graph,
  packets, pulse, mentions, summaries and cached projections, not only Workshop.
- [x] Prevent generic writes from forging participants, disclosure or snapshots.
  Disclosure is revision-safe and never overrides underlying private scopes.
- [x] Keep operational status and urgent safety information available without
  copying hidden hypotheses. Preserve ordinary public community operation.
- [x] Tie review to submitted revisions; reopening or changed evidence invalidates
  affected approval. Reuse existing review and handoff instead of a new ledger.
- [x] Add progressive guidance through wiki.policy and protected Vault guidance.
  Distinguish guidance-only independent attempts from server-enforced isolation.

## Limits and acceptance

The server cannot erase conclusions already in a model's context, prevent local
filesystem access by the host, or control other channels. Same-account sessions
are not independently authenticated readers. Do not promise absolute isolation.

- [x] RED/GREEN tests for the common private-service boundary, direct note/search
  denial, own/peer views and status/cursors, scope-safe disclosure, stale revisions,
  revoked access, concurrent submissions and restart. Broader common projections
  reuse the existing private-path predicate; this is not an exhaustive side-channel
  proof or a claim to control host filesystem access.
- [x] Run a limited early-versus-delayed standardized peer-exposure pilot on the same small
  research set and comparable budgets. Measure supported candidates, alternative
  exploration, error correction, unresolved conclusions, I/O and response size.
- [x] At most two actual isolated model sessions, sequentially; label actual
  behavior separately from protocol simulation. No automatic worker fan-out.
- [ ] Broader actual multi-agent research comparison (not satisfied by scripted
  peer evidence): repeated/counterbalanced runs and direct host/MCP use remain
  future evaluation, not a claimed outcome of the two-session pilot.
- [x] After host stability: targeted tests, build, one-worker full suite, diff
  check, shared-server verification, then only user-fork source/docs/tests/dist.

## Host stability prerequisite

On 2026-09-09 the user reported a freeze and restart. Prioritize bounded disk,
pagefile and test-temp diagnostics. Do not move the production Vault or modify
OS virtual-memory settings based only on a suspected cause. NAS migration is a
separate verified copy/cutover/rollback task, not part of research isolation.
