---
id: retrieval-exposure
kind: implementation-plan
description: Verified retention receipts, repeated delivery and conservative delta.
keywords: [receipts, delta, cooldown, context epoch, 중복]
parent: README.md
previous: 05-skills.md
next: 07-feedback-graph.md
---
# Exposure and delta
Use: R4 context delivery. Not: a time-based ban on reading.
Keep computation cache separate from exposure history.
Key: account, worker, session, context epoch, task scope, resource and revision.
Also bind representation version and exact returned ranges.
Sent, received and retained are distinct states; unknown host retention is context_unknown.
Only verified retained, unchanged descriptions suppress repeat recommendations.
Never disable tool invocation, explicit schema reads or requested rereads.
Repeated documents use a short grouped notice plus read actions.
Explicit reread needs no additional confirmation question.
Compaction, restart, scope, ACL and rule changes invalidate affected receipts.
Strong suppression stays OFF where host confirmation is unsupported.
Delta requires an exact retained base/representation/range and current access to both revisions.
Preserve semantic units: negation, exceptions, quantities, units and removed conditions.
No valid base, inaccessible base or costlier delta -> current bounded chapter.
Lost responses never advance the acknowledged base revision.
Reading is not proof of understanding, validation or task completion.
Candidate caches invalidate for new relevant documents/counterpoints as well as edits.
Do not retain hidden titles, contents or diagnostic counts in unauthorized output.

## Acceptance
Forged receipts, lost delivery, context resets and cross-session/account reuse.
Revocation after cache hit, representation drift, reordered sections and removed exceptions.
Compare serialized packet plus follow-up reads, not only shortened body text.
Example: same confirmed chapter/revision -> compact notice; explicit reread -> full bounded read.
