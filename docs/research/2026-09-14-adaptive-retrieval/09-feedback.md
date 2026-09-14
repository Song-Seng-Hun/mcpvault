---
id: adaptive-retrieval-09-feedback
kind: research-proposal
description: Scoped relevance feedback and reversible repair decisions.
keywords: [retrieval, statechart, scale, context, 검색]
use_when: Evaluating scoped relevance feedback and reversible repair decisions.
skip_when: Seeking an approved runtime contract or measured production capacity.
position: 9 of 14; see parent for navigation.
parent: README.md
previous: 08-delta.md
next: 10-graph.md
status: proposed-not-implemented
---
# Relevance feedback without suppression bias

Replace “junk” with reasons: wrong_topic, wrong_entity, wrong_version, duplicate_family.
Also distinguish stale_projection, insufficient_evidence, optional_skill_noise and rendering_error.
Transport timeout is operational, not relevance. Disagreement and no click are not negative truth labels.
Exposure affects feedback; clicks are not neutral training labels.[S7]

## Events

Bind marks to an actually exposed result receipt, revision, intent, task and current reviewer identity.
Store bounded evidence/reason, not the whole conversation or private query in public notes.
One task/result/revision/reason counts once; retries or several workers cannot multiply it.
Verify access before recording or returning review details.
Keep current feedback process-local unless explicit host privacy/storage policy permits persistence.
A trial threshold of3independent tasks creates review eligibility, never a truth verdict.
Use per-account caps and existing review authority against coordinated marking.

## Action ladder

Duplicate: omit only the duplicate copy in this response; retain its family source.
Repeated contextual mismatch: propose a small reversible context-specific penalty.
Automatic application requires explicit policy; it is not enabled by collecting feedback.
Mandatory rules, exact targets and required counterpoints bypass optional relevance penalties.
Bound penalties, preserve direct discovery and maintain a control cohort for evaluation.
Stale projection: use permitted derivative repair, not punishment of authoritative content.
Bad alias/classification: propose a revision-checked repair via existing maintenance/change-set.
Meaning, access, contradiction resolution, deletion and skill promotion remain review-only.
New revision invalidates the old penalty pending recheck; past marks remain historical.
Record reasons and rollback basis; the loop cannot change its own approval rules.
Demotion reduces exposure and can hide further errors; compare matched query distributions.
Begin offline/shadow. Do not explore by omitting safety rules or exposing private content.
Reuse exception board, not a separate dashboard or document-wide blacklist.
See [feedback research](13-sources-retrieval.md); thresholds are proposed trials.
