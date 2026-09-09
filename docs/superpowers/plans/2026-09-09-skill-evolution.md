# Skill evolution implementation plan

Approved user plan: evolve procedural references through use, recorded evidence,
candidate changes, fixed comparative evaluation, promotion and rollback. Work is
performed in the current agent session, never by a new background/model service.

## Work packages

- [ ] Preserve imported `Community/Skills/<id>` documents. Add signed, visible
  Markdown experience/candidate/evaluation/version/current records below
  `_evolution/`. Signatures attest host decisions, not factual truth or execution
  permission; the key is host configuration, never a Vault property.
- [ ] Add an opt-in service with authenticated, revision-guarded writes, stable
  request IDs, exact evidence locators, private-to-Community rejection, bounded
  reads, conflict handling, candidate rejection, promotion and rollback.
- [ ] Add fixed host evaluator profiles. Compare the same cases, require no
  regression plus an actual targeted improvement, fail closed on missing or
  ambiguous evaluation, and bind results to source/candidate/profile revisions.
  Arbitrary endpoint data, imported scripts and claimed pass booleans are inert.
- [ ] Expose `skill.resolve`, `skill.experience`, `skill.candidate`,
  `skill.evaluate`, `skill.promote`, and `skill.rollback` through the existing
  five-tool control plane and common MCP/REST dispatcher. Keep read-only reads
  available and reject every mutation, including mixed-operation endpoints.
- [ ] Route normal retrieval to the valid current version; keep audit records
  out of default recommendations while allowing explicit bounded reads. Offer
  one relevant candidate in pulse without changing work priority or waking a
  model. Update policy and client guidance progressively.
- [ ] Verify source refresh, external edits, conflicting promotion, forged
  results/approvals, evidence drift, retries, recovery, scope/path filtering,
  matching Markdown fences, MCP/REST parity and bounded outputs.
- [ ] Run targeted tests, build, complete test suite and diff checks. Review
  against the approved requirements and security boundaries; commit generated
  `dist/` with source and push only the user's fork.

## Defaults and compatibility

No relocation or rewrite of installed/imported skills. Profile-less skills may
accumulate experience and candidates but cannot auto-promote. The host explicitly
registers trusted evaluator callbacks, their revisions, an attestation key and
approval account IDs; no request or note can register one. The initial deployment
remains opt-in. Synthetic fixtures prove the complete pipeline; production
profiles require host approval before automatic promotion is enabled.

Ordinary private task material remains private. Shared experience is an explicit,
shareable summary with visible evidence, never an automatic raw-log transfer.
Reading a skill is not proof it was applied. One representative experience per
task is the client default. User fork commit/push is authorized; upstream PRs,
package publishing and unrelated files remain out of scope.
