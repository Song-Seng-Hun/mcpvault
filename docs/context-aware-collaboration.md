# Context-aware review and advisory staffing

These are opt-in Work contracts, not an agent runner, an expertise certificate,
or a grant to run code. The five MCP controls remain unchanged. Use
`call_endpoint` for the dynamic endpoints below. MCP and REST share the same
service, authorization, revision guards and delivery receipts.

## Enable for new work, preserve existing history

The project owner supplies `reviewPolicy: {version: 2}` to `work.project`.
Only subsequently created tasks inherit `work_review_contract: 2` and a policy
snapshot. Existing work stays on its original contract. Its task requester may
explicitly submit `migrateReviewContract: true` with current revision/generation;
completed work and already-v2 work cannot be migrated again. Existing review
history remains attributed history, not a retroactive v2 approval.

`requireHostExecution: true` requires positive host-observed execution evidence.
`optionalCriteria` may name optional checks on ordinary work; high-risk checks
remain mandatory. A reviewer cannot change this policy. Strengthened project
requirements invalidate approvals; an existing task's stronger execution
requirement cannot be erased by weakening the project configuration.

## Provide actual change context

Use `changeContext` in the normal task create/update call:

```json
{
  "reason": "Correct the parser's empty-input behavior",
  "scope": "Parser and its focused regression test",
  "constraints": ["Preserve private-scope isolation"],
  "decisions": [],
  "risks": [],
  "dissent": [],
  "unverified": [],
  "locators": [
    {"id":"before","role":"before","path":"Sources/parser-before.md","revision":"<exact SHA-256>","startLine":1,"endLine":20},
    {"id":"after","role":"after","path":"Knowledge/parser.md","revision":"<current SHA-256>","startLine":1,"endLine":20},
    {"id":"test","role":"test","path":"Sources/parser-test.md","revision":"<exact SHA-256>","startLine":1,"endLine":8}
  ]
}
```

The example placeholders are not valid hashes. Store real immutable before/test
snapshots through the existing source workflows, preserving provenance; do not
copy private conversations or reasoning into this public Work record. Notes are
read at their declared current revision, not silently reconstructed from mutable
history. A changed note requires a refreshed locator or a separate immutable
snapshot. Line numbers are 1-based **raw Markdown lines, including Properties**,
consistent with source packets. Each explicit range is at most 1,000 lines, with
at most 20 explicit locators. All selected ranges, including implicit upstream
tasks, together may cover at most 1,000 lines so their receipts fit one review
submission. An individual JSON-encoded line must fit 8,000 characters. Split the
work or ranges when these admission budgets are exceeded.
Work note and review-original reads, including preliminary artifact/dependency
checks and final revision guards, are capped at 8 MiB per source. Oversized
context blocks approval; project board/coverage views mark only the affected
review unverified with `context_budget_exceeded` rather than failing the board.
Roles are `before`, `after`, `diff`, `source`,
`test`, and `upstream`.

Before/after note snapshots must share a nonempty `source_work_id` (or
`source_family`) in their revision-pinned Properties; unknown or unrelated source
identity cannot establish the pair. Git pairs must share repository and relative
file. Both require distinct exact revisions. A conservative first-to-last changed
line window must be covered by the delivered ranges; reading only unchanged
Properties is insufficient. Source identity is declared provenance, not proof of
chronology or a guarantee that an author supplied truthful history.

Git locators instead provide credential-free HTTPS `repository`, full immutable
`commit`, canonical relative `file`, and line range. They require a trusted host
reader; without one external verification remains unavailable. The server never
fetches arbitrary caller URLs or runs a submitted command. Declared task artifact
paths/revisions and Git files must match delivered `after` locators. Test
snapshots must match an actual artifact after revision cited by that criterion,
not an unrelated passing test. Before/after reads cannot be made optional.

Parent/dependency task revisions are implicit upstream context, including
transitive ancestors. Their exact original ranges are added to the manifest;
omitting them from the author's locator list does not bypass delivery checks.
An unavailable, excessively large or changing required source blocks approval.
Project goal, allowed work, criteria, perspective policy and review policy also
participate in the approval fingerprint. Current views recompute freshness.

## Review one current version

1. The assignee calls `work.review` with `op: "request"` and current
   revision/generation.
2. The reviewer calls `work.review_context` for the compact manifest, following
   its cursor. Then read every required `locatorId`, following original-range
   continuation until complete. No body is copied into `work.packet`.
3. Retain each original-range `receipt`. It binds the authenticated account,
   task, complete review basis, locator and delivered range. Tokens expire after
   30 minutes and are lost on server restart; reread then. They cannot be shared
   between accounts, tasks or versions. Receipts are not proofs of understanding.
4. Submit `work.review` with current `artifactFingerprint`, `contextReceipts`,
   and one `checks` entry for every exact task completion criterion:

```json
{
  "criterion": "Empty input remains safe",
  "verdict": "pass",
  "rationale": "The before/after comparison and focused empty-input case address the changed parser",
  "evidenceIds": ["before", "after", "test"],
  "missingChecks": [],
  "tests": [{
    "locatorId": "test",
    "snapshot": "<actual after revision or commit>",
    "environment": "isolated parser fixture",
    "result": "pass",
    "missingChecks": []
  }]
}
```

Verdicts are `pass`, `fail`, `unknown`, or `not_applicable`. A mandatory criterion
must pass, cite before/actual-after evidence and have change-specific verification
with no missing checks. Manual research or writing verification may be recorded
as an explicitly described test; it is not automatically a program execution.
Required fail/unknown/N/A, unresolved dissent/unverified items, missing original
delivery, stale sources and mismatched tests prevent approval. An unknown check
with explicit missing checks can instead be recorded as `question` or
`changes_requested`, without pretending the missing context was read.

Ordinary v2 work may use explicit `self_verify` by its current assignee. This is
labeled `self_verified`, never `independently_reviewed`. Independent approval
rejects all author/requester/assignee accounts, even with a different model or
role. Security, permissions, shared-policy and destructive work cannot self-verify.
A host moderator's explicit `override` is labeled `host_override`, not fabricated
review or execution evidence. All completion adapters, including ordinary task
updates and the paid Work bridge, retain the shared completion gate and the
existing knowledge-disposition requirement.

Structured checks stay in attributed Markdown review history. Large reviews are
split into criterion/evidence/test/missing-check items in packets. Views default
to 20 items/4,000 JSON characters, maximum 100/12,000; follow cursors rather than
copying a whole history. Revision locks cover at most 128 related notes for v2;
legacy Work mutations retain their nine-note limit. Direct authorized Obsidian or
Git edits remain outside preventive API guards and require review.

## Staffing is a recommendation, not a dispatch

The owner may configure `staffingPolicy` on `work.project`:

- `taskType`: `code`, `research`, `writing`, or `planning`;
- `factualVerification`, `requiredTools`, `requiredCapabilities`, `minimumTier`;
- `budget` and configurable role-to-family `preferences`.

Read `work.staffing` with `projectId` and optionally `taskId`. It uses eligible
registered project accounts and host-supplied execution profiles, never caller
claims of `hostVerified`, inferred provider names, parameter counts or reputation.
Unknown execution identity stays unknown. Profiles carry provider/family/exact
version, reasoning, tools, capability qualifications, tier, budget and cost.

Defaults cover code implementation/change-impact/test; research source/counterpoint;
writing language/continuity plus factual verification when needed; planning
constraints/feasibility/risk. Owner-adjustable `requiredPerspectives` are not
permanent departments. High-risk independent-account review cannot be removed.
Optional marketing is not a required department.

Eligibility, tools, qualification, budgets and WIP gate selection. Essential gaps,
independent reviewers and cross-family diversity precede configurable role
preferences and cost/load. Existing active ownership stays in place; reuse suitable
coverage or sequential hats before asking the host for more workers. Different
execution tiers are secondary diversity, not a claim that larger is better.
Limited qualified availability is explained, not replaced with fictitious peers.

Initial family preferences reflect this user's choices: Gemini for creative,
dialogue, story, translation, plain-language and YouTube work; Claude for direction,
ideas, planning and decomposition; GPT for implementation, tests, evidence, theory
and tools. They are not measured universal rankings. No blanket Fable biology or
ML penalty, provider-safety workaround, membership change or automatic spawn exists.

`work.coverage` separates declared responsibility from current verification level.
The report remains advisory: delivery does not prove comprehension, a structured
pass can still be dishonest, and separate accounts do not prove separate human
control or prevent collusion.

## Trusted host integration

Library hosts may supply `createServer(vault, {workCollaboration: ...})`:

- `executionProfiles()` returns currently observed profiles. Supply only metadata
  the host can actually verify; never turn model display labels into attestation.
- `readReviewGitSource(locator)` returns exact immutable content and matching
  commit revision from an explicitly admitted repository. Do not execute locator
  strings, fetch arbitrary URLs or bypass provider controls. Bound the host read
  itself to 8 MiB; the service also rejects larger returned content.
- `verifyReviewExecution(executionId, expected)` verifies an existing host result
  against the exact context fingerprint, criterion, test locator/revision, actual
  snapshot and environment. `true` is a trusted host assertion, not an API field.

The stock runtime leaves these optional integrations unconfigured. It still
supports note-backed review; staffing reports unknown availability and projects
requiring external/host execution remain pending. Do not manufacture verified
profiles or test results simply to make the queue green. This feature neither
starts models nor runs tests as a side effect of a review.
