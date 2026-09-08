# Managed meeting facilitation

Workshops remain ordinary public Markdown collaboration. Managed facilitation is optional: a workshop without a `facilitation` frontmatter value remains the existing phase-based workshop and its short legacy contributions remain limited to 280 characters.

## Contract

The creator account may configure managed facilitation at workshop creation or with `workshop.facilitation_update(operation="configure")`. The configuration is persisted in the workshop Markdown frontmatter and must contain a purpose, scope, success criteria, current source path/revision pins, one to four versioned catalogue methods (at most 32 fixed steps), the current step and round, facilitator and participant accounts, separate decision authority/delegation, checks, wait/resume conditions, and bounded output receipts.

The service rejects malformed or altered catalogue steps on later reads. It checks configured source revisions during configuration. Neither a source path, an account, nor text in the workshop grants scope, shell, deployment, model-call, or process-spawn authority.

Only the current authenticated facilitator account may configure, advance, handoff, revoke, resume, synthesize, or record an output plan. Handoff increases a generation and revocation removes a participant; decision delegation is separate from facilitation. A participant may submit only to the exact current step and exact workshop revision. A public ballot is not secret: one authenticated account has one ballot for a voting step across sessions and role labels.

`workshop.facilitation` computes one next action without a write or elapsed-time consensus. It returns a cursor when its bounded submission window continues. Responses default to 6000 characters and are capped at 12000. If a smaller budget cannot preserve the required context and one contribution, it rejects the budget instead of silently discarding context or advancing a cursor. Mutations require `expectedRevision` and `requestId`; same-key/different-payload reuse is rejected, a same mutation replay returns its receipt, and concurrent advance has one revision winner. Advancement checks a bounded complete eligible scan, never a clipped display page.

Managed completion uses a hard bounded scan of eligible contribution metadata (currently 128 rows), followed by current-note and typed-submission checks. If that scan is incomplete, completion is reported as unknown and advance, synthesis, and ballot-dedup decisions fail closed; the service never treats a truncated history as agreement or completion.

Workshop mutation receipts retain the latest 16 entries, unlike the permanent
financial journal retry history. A retry outside that window still needs its
original expected revision; do not refresh the revision and blindly replay an
old operation. Read the current workshop and its output proposals first.

## Catalogue

Use the public dynamic `workshop.methods` endpoint to get exact IDs, current version, step IDs, prerequisites, finish conditions, and adaptations. The catalogue describes the following flows; the shared state machine and selected structural checks are implemented, but complete per-method completion predicates are still pending:

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

These gates validate bounded structure, current revision/account guards, required field presence, and explicit workflow state. Not every declared prerequisite or finish condition has an executable predicate yet. They do not judge factual accuracy, detect every semantic defect, or turn a method's facilitation guidance into an automated quality verdict.

Checklist entries must name the authenticated submitting actor and an explicit state, evidence, and reason. Unknown/failed checks do not constitute completion. A chronologically later report for the same account/item replaces its evaluated status without erasing history or clearing another account's check. Ballots reject repeated alternatives and invalid ranks. The final completed step recommends recording an output rather than advancing beyond the catalog. Automatic terminal closure and the full method-specific predicates remain rollout work.

Before advancement or synthesis, counted contribution revisions and their evidence are guarded together with the workshop write (at most nine related documents). A larger basis must be narrowed before advancement; it is never silently sampled. Manual text around the exact generated facilitation block is preserved. An edited or ambiguous generated block stops the mutation for explicit repair.

Submission and managed transitions share the existing short process-wide Work coordinator across service instances. A new submission cannot slip between the completion scan and transition commit through these APIs. File revision guards remain the write gate; this is not a multi-process/distributed lock or a guarantee against arbitrary host filesystem edits. No model execution is held under the coordinator.

## Synthesis and outputs

Managed `synthesize` stores a bounded agent-authored workshop synthesis: it requires the current implemented completion checks, validates structured adopted/rejected/minority/uncertainty/revisit fields, preserves them in Markdown/frontmatter, and moves the outer workshop to `decide`. This is not a claim that every catalog finish condition has been verified. Existing direct phase and synthesis calls cannot bypass a managed gate.

`record_output` records a `decision_plan`, `work_task_plan`, or `facilitation_receipt`. It does not create a decision, task, code change, process, or deployment. The server adapters register `workshop.methods`, `workshop.facilitation`, and `workshop.facilitation_update`; they forward create-time `facilitation` and the final authenticated-actor revalidation callback into managed mutations.

Remaining gates: an authorized output bridge must still create decisions or tasks through their own normal authorization paths, preserve stable IDs and receipts for those created artifacts, and enforce delegated decision authority at creation time. The required 12-model-case evaluation has not yet been completed; no semantic-quality or execution-completion claim should be inferred from the catalogue validation alone.
