# Managed meeting facilitation

For the original 6-3-5 variant, exactly six configured authenticated accounts
submit three ideas each in cycle 1, then three extensions of other accounts'
previous-cycle ideas in cycles 2–6. `brainwritingCycle` is separate from ordinary
re-discussion `round`; each explicit `advance` persists the next cycle without
consuming the one redo. Every submission declares `variant: 6-3-5`, the current
`cycle`, and `cycleMinutes: 5`. This is declared timing, not a claim that a timer
verified five minutes of work. Missing peers cannot be fabricated; choose the
explicit async/small-group variant instead. Read pages count only the current
cycle, while guarded prerequisites retain prior origins.

Workshops remain ordinary public Markdown collaboration. Managed facilitation is optional: a workshop without a `facilitation` frontmatter value remains the existing phase-based workshop and its short legacy contributions remain limited to 280 characters.

## Contract

The creator account may configure managed facilitation at workshop creation or with `workshop.facilitation_update(operation="configure")`. The configuration is persisted in the workshop Markdown frontmatter and must contain a purpose, scope, success criteria, current source path/revision pins, one to four versioned catalogue methods (at most 32 fixed steps), the current step and round, facilitator and participant accounts, separate decision authority/delegation, checks, wait/resume conditions, and bounded output receipts.

The service rejects malformed or altered catalogue steps on later reads. It checks configured source revisions during configuration. Neither a source path, an account, nor text in the workshop grants scope, shell, deployment, model-call, or process-spawn authority.

Only the current authenticated facilitator account may configure, advance, handoff, revoke, resume, synthesize, or record an output plan. Handoff increases a generation and revocation removes a participant; decision delegation is separate from facilitation. A participant may submit only to the exact current step and exact workshop revision. A public ballot is not secret: one authenticated account has one ballot for a voting step across sessions and role labels.

`workshop.facilitation` computes one next action without a write or elapsed-time consensus. It returns a cursor when its bounded submission window continues. Responses default to 6000 characters and are capped at 12000. If a smaller budget cannot preserve the required context and one contribution, it rejects the budget instead of silently discarding context or advancing a cursor. Mutations require `expectedRevision` and `requestId`; same-key/different-payload reuse is rejected, a same mutation replay returns its receipt, and concurrent advance has one revision winner. Advancement checks a bounded complete eligible scan, never a clipped display page.

Completion reads at most 128 current-step rows and only the required predecessor steps (at most 256 combined candidates). Unrelated transcript history cannot crowd out the current step. Parent-origin lookups use referenced IDs. Every accepted candidate is re-opened, scope checked and typed validated. A truncated prerequisite scan blocks completion rather than guessing. `workshop.read` remains the historical discussion view; `workshop.facilitation` pages the current step independently of its completion gate.

Workshop mutation receipts retain the latest 16 entries, unlike the permanent
financial journal retry history. A retry outside that window still needs its
original expected revision; do not refresh the revision and blindly replay an
old operation. Read the current workshop and its output proposals first.

## Catalogue

Use public `workshop.methods` for method IDs and steps. Add both `methodId` and `stepId` for that step's structured input schema and worked shape. `workshop.facilitation` includes the current shape, adapted to the authenticated account and source pins. Examples are placeholders, never evidence. The following flows have typed submission and completion gates:

- Page-led: purpose/scope/outcome/questions and source revisions, read acknowledgements/questions, then discussion.
- Checklist: preparation/progress/closing with unknown/pass/fail/not_applicable, evidence, reason, and actor.
- How might we: observed problem, open questions, and refinement of too-broad or solution-forcing wording.
- Brainwriting: independent ideas and named extensions. True 6-3-5 needs six actual accounts, three ideas each round, and an explicit five-minute cycle; generic, async, and small-group variants are declared.
- Six hats: product-default setup, information, alternatives, benefits, risks, tentative intuition/preferences, and synthesis—not a universal official order—with the same agents taking sequential views.
- SCAMPER: substitute, combine, adapt, modify, other use, eliminate, and reverse retain parent ideas.
- Crazy 8s: eight distinct alternatives then selection; async/text uses eight short alternatives.
- 1-2-4-All: individual, pairs, fours, all; wait for actual accounts or declare a reduced variant, never fabricate people.
- Affinity/KJ: collect, groups, and names while preserving originals, ungrouped items, and multiple membership.
- Mind map: root question, question/alternative/constraint/evidence branches, and explained Markdown cross-links for later Canvas projection.
- NGT: independent, round-robin, clarify, rank; votes count rather than verbosity.
- Dot voting: freeze alternatives and criteria before public account-deduplicated rankings; rankings are not truth or approval.
- DACI: driver/approver/contributors/informed, alternatives/evidence, reason, review conditions.
- Premortem: assumed failure, causes, prioritized risks, mitigation/early signal/owner action.
- Retrospective: Start/Stop/Continue or 4Ls observations, then a reviewable improvement experiment.
- Blameless postmortem: timeline/impact/contributing factors/helpful response/prevention. It guides authors toward system conditions rather than personal blame, without keyword-based censorship.

Structured submissions are bounded arrays and objects: idea IDs/origin/extensions/challenges, original-preserving groups, checklist evidence/reasons, an account ballot, explicit map nodes/edges, and adopted/rejected/minority/uncertainty/revisit synthesis. Long content belongs in visible referenced notes; inaccessible or more-private paths are rejected.

These gates validate bounded structure, current revision/account guards, explicit prerequisites and workflow state. They do not judge factual accuracy, every semantic defect, novelty, or the quality of an answer. A finish condition phrased as good facilitation practice is not a machine-certified quality verdict.

Checklist entries name the submitting actor, state, evidence and reason. Unknown/failed checks do not constitute completion. A later report repairs only that account's item without erasing history. Ballots reject repeated alternatives and invalid ranks; changed frozen alternatives require a new round. The final completed step permits synthesis, followed by an explicit `close` with a reason. Time alone never closes a meeting.

Before advancement or synthesis, counted contributions, prerequisites and evidence are guarded with the workshop write (at most 128 related documents for this internal path; ordinary writes keep their existing limits). Larger bases must be narrowed without dropping evidence. Manual text around the exact generated block is preserved; an edited or ambiguous block stops for repair. `pause` records a reason and resume condition; `resume` explicitly clears the pause. `redo` permits one ordinary re-discussion and increments the round, retaining earlier contributions. Published outputs require a linked follow-up instead of silently redoing them.

Submission and managed transitions share the existing short process-wide Work coordinator across service instances. A new submission cannot slip between the completion scan and transition commit through these APIs. File revision guards remain the write gate; this is not a multi-process/distributed lock or a guarantee against arbitrary host filesystem edits. No model execution is held under the coordinator.

## Synthesis and outputs

Managed `synthesize` stores a bounded agent-authored workshop synthesis: it requires the current implemented completion checks, validates structured adopted/rejected/minority/uncertainty/revisit fields, preserves them in Markdown/frontmatter, and moves the outer workshop to `decide`. This is not a claim that every catalog finish condition has been verified. Existing direct phase and synthesis calls cannot bypass a managed gate.

`record_output` records a `decision_plan`, `work_task_plan`, or `facilitation_receipt`. It does not create a decision, task, code change, process, or deployment. The server adapters register `workshop.methods`, `workshop.facilitation`, and `workshop.facilitation_update`; they forward create-time `facilitation` and the final authenticated-actor revalidation callback into managed mutations.

`delegate` requires the current facilitator to own the named existing Work project. Its payload is `{projectId, accountId, decisionKinds, taskKinds, scope, reason, revoked?}`. The delegate must be a current workshop participant and project member. Revocation, removal, project ownership change and missing publish/task capability block output creation. Natural-language scope still needs the agent's judgment; it is not a shell permission.

After a reviewed synthesis, `execute_output` accepts a stable `outputId`, `type` (`decision` or `task`), allowed `kind`, `title`, and type-specific content. Decisions need `context`, `decision`, `minority`, `uncertainty`, `revisit`, and valid immutable `evidencePaths`; alternatives and consequences remain available. Tasks need `description` and `completionCriteria`. Task kinds are `general`, `security`, `permissions`, `shared_policy`, `destructive`; existing risk review rules remain active. Decision kind names must match the explicit project delegation.

Outputs use the existing Decision Record/Work service. A stable output ID cannot change its type or payload. The output stores its receipt and the workshop records a wikilink and exact created revision. If the response or workshop-link write is lost, reread the workshop and retry the same output ID and identical payload; the existing output is verified and the missing link is repaired. After success, use returned `workshopRevision` for the next workshop operation, not the output's revision. Final synthesis is `{adopted:[], rejected:[], minority:[], uncertainty:[], revisit:"condition"}`; these are explicit observations, not another copy of the last method's form.

Output creation first persists a pending reservation in the workshop. A crash
before the backlink therefore remains discoverable and blocks redo/close. Retry
the same payload only with unchanged review basis and current project authority;
an edited basis is a conflict, not permission to recreate an accepted decision.
Authentication, capability and moderation are checked at final output dispatch,
not merely when the workshop command was received.

If validation failed before any output was created, the current facilitator may
use `workshop.facilitation_update` with `operation: cancel_output`, current
`expectedRevision`, a retry `requestId`, and `payload: {outputId, reason}`. Both
possible output paths must still be absent under revision locks. Cancellation
records its reason and never deletes a created output. Source drift need not trap
an absent reservation, but a committed output must be reconciled, not cancelled.
Oversized assembled decision context is rejected before reservation.

Protocol tests and actual-model comparisons are separate evidence. See the completion checklist for evaluation and deployment status; structural validation does not prove improved meeting quality.
