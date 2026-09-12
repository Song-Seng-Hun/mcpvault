# LLM Wiki v2 improvements — execution record

Approved 2026-09-12. Baseline `b29cc2be`, existing user-fork `main`.
Preserve unrelated files, originals, canonical economy/world data and host secrets.
No new branch, upstream publication, paid model calls or NAS/Telnet changes.

## Delivery gates

- [x] A: fixed 80-query evaluation (original 40 unchanged), optional evidence-mode
  retrieval with equal-weight RRF k=60/20 candidates per channel, strict query
  constraints, one-hop relations and safety-first evidence budgets.
- [x] A: targeted tests, build, full suite, independent spec/quality reviews,
  NAS-backed deployment/live verification, source+dist commit and fork push.
- [x] B: grouped revision-bound exception board, review/snooze revalidation,
  host-opt-in serialized maintenance, derived repair and host-receipted link
  recovery only. No inferred external moves, content synthesis or lifecycle edits.
- [x] B: targeted safety/recovery tests, build, full suite, independent reviews,
  deployment/live verification. Source+dist publication is the final Git step;
  its commit and remote confirmation are reported in the delivery task.

## Evaluation/defaults

Compare both modes at 4000 and 12000 serialized characters. Require no per-language
Recall@5/MRR regression, at least 5 percentage points better overall exact evidence
coverage and no increase in negative false positives for promotion. Failure leaves
evidence mode opt-in; never tune corpus truth to the implementation. Synthetic,
mock inference and actual local inference results must be reported separately.

Automatic maintenance requires explicit host-approved paths and operations plus
current independent document authority. Without that configuration it stays off.
All canonical repairs use exact revision/change-set fingerprints and rereads.
Private receipts/backups are operational evidence, never permission or knowledge.

## Progress

- Read-only baseline confirmed. Seven pre-existing untracked research documents
  remain unrelated and excluded. Previous preservation release remains active.
- Evaluation fixture sidecar delegated with disjoint paths; main owns retrieval,
  integration, deployment and the single heavy-test slot.
- A implementation and targeted regressions are present. Latest targeted groups:
  36/36 search/security tests, 29/29 corpus/packet tests; build passed. Independent
  spec re-review and subsequent quality review remain gates, not assumed passes.
- Frozen 80-query rerun: 4000-character evidence coverage +5.49 pp; 12000-character
  coverage unchanged and all-language MRR regressed. Overall promotion failed;
  evidence remains opt-in, legacy remains default. Actual cached multilingual
  inference smoke passed separately; full semantic corpus quality is unmeasured.
- No A deployment/commit/push or B implementation has occurred yet.
- Subsequent spec fixes: prerequisite identity, exact backlink-page continuation,
  evidence cap warnings, safety continuation priority, ancestry read location and
  unrestricted MRR. 69/69 targeted tests and build passed; independent static SPEC
  review passed. Quality/security review and 32 serial regression shards started.
- Corrected MRR: at 4000 legacy/evidence 0.6185/0.7523; at 12000
  0.6441/0.6218. Gate outcome remains unchanged. Current quality metrics are from
  session 48429, not the older MRR@5 table.
- Quality review found/fixed dual-role source/counterpoint identity and restored
  deployment PDF-busy checks. Both locator variants observed RED then GREEN;
  evidence tests 21/21 and rebuild passed. Static quality/security re-review passed.
  The interrupted final1 shard run is not completion evidence. A fresh final2
  run covers the new source basis; staging must match its rebuilt dist.
- All 32 final2 shards finished on source/test/build basis
  `abc12ede0072a38bb656e6f4e05e18500295a1bb2a3c74192f7748ada23746ec`.
  Shard 16 had one first-test setup failure in the unchanged native-database
  `semantic-reuse.test.ts`; the other 26 tests in that file passed. Its original
  report, exit receipt and failure log were retained with `.initial-failed`
  suffixes before a same-basis diagnostic rerun. No timeouts or source were
  changed to suppress the failure. The diagnostic rerun passed all 180 tests;
  the initial setup failure was not reproduced, and its precise cause remains
  unconfirmed. The final same-basis collector verified all 441 files and 6182
  assertions: 6179 passed, 3 pre-existing allowed platform skips, 0 failed,
  0 absent files and no unreceipted reports. Minimum observed free RAM across
  the full run was 3.820 GiB; no memory guard interruption occurred.
- Final fixed-corpus measurement (session 99922, 12/12 passed): the dual-role
  safety fix increases 4000-character evidence coverage to 73/91 versus 66/91
  legacy, **+7.69 pp**, superseding the earlier +5.49 pp snapshot. 12000 remains
  unchanged with MRR regression; default promotion remains rejected. Full final
  per-language results are in the evaluation contract. No gold or source changed.
- A NAS-backed runtime switched to the preserved `20260912-wiki-v2-a` release.
  Read-only live acceptance passed: five fixed tools, evidence question mode,
  exact source revision, strict option boundary, existing document/owner-consent
  behavior and active capability catalog. No credentials, model execution or
  canonical note writes were used by the probes. Original/backup/restore bytes
  still match; original, world and economy byte fingerprints and checkpoints
  are unchanged. Prior release and launcher remain available for rollback.
  Telnet stayed off; NAS direct-write protection remains out of scope.
- Staged path/content screening and whitespace checks passed for the 22 A files.
  Seven unrelated research files, host data and the B contract remain excluded.
  Commit and fork-push are the remaining A delivery steps at this record point.
- A delivery completed in commit `a2fa485bc8f1e29f40a59905b84a67f998e5ecf6`.
  Push to the user's `Song-Seng-Hun/mcpvault` fork succeeded; `ls-remote` confirmed
  the same main revision. B now starts from this separately delivered baseline.
- B implements a grouped current-revision review projection in a separate service;
  the MCP endpoint defaults to groups and retains explicit legacy flat output.
  Snooze bases include current body/Property-linked evidence and incoming argument
  dependencies. Fixed priority tiers and compact retry actions remain advisory.
- B adds a host-private exact-path/operation allowlist, exclusive writer, bounded
  recovery receipts, serialized jobs, current account/moderation/grant checks,
  existing move-planner capture and revision/fingerprint-guarded one-note repair.
  Cache/managed Canvas repair reuse current services without inference. Protected
  derivatives and ambiguous move observations stay manual. No live allowlist is
  created, no automatic execution is enabled, and no NAS/Telnet setting changes.
- Initial B maintenance-related tests: 338 passed plus one conditional Windows
  file-symlink privilege skip. Actual junction, hard-link, replacement and private
  ACL rejection tests pass. Existing adapter/Canvas/change-set/document/moderation
  checks passed in groups of 174 and 52 assertions. These are targeted, not full
  regression evidence.
- Independent SPEC review found final grant revocation, linked-source snooze,
  source-to-Canvas event routing, overflow preservation and a post-move observation
  race. Each was reproduced before correction. The existing catalog reconciliation
  now has a host observer (no new timer/watcher); it remains read-triggered.
  Final related tests: 59/59 passed, strict build passed. Independent SPEC passed;
  QUALITY, a fresh exhaustive regression, deployment/live checks and B commit/push
  are still pending at this record point.
- QUALITY review reproduced three additional cases: an observation gap during
  the final awaited reference read, validation-budget exhaustion dropping every
  group, and a refused writer cleanup stranding other runtime resources. Added a
  synchronous trusted dispatch fence, reserved group-validation reads, and ordered
  all-resource cleanup with aggregated errors. New repros observed RED; affected
  service/review/runtime tests passed 66/66 and the strict build passed. QUALITY
  re-review and final delivery gates remain pending.
- Follow-up QUALITY review identified the preview-to-applying transition restoring
  an invalidated move. Added RED coverage there and after a completed write before
  verification, then fenced all post-await applying/verified transitions. All 30
  service tests pass; uncertain observations remain review-required, including
  already-written outputs retained with their exact private recovery intent.
- Final B targeted maintenance/catalog run passed 357 assertions with one exact
  Windows file-symlink privilege skip (16 files). The strict build passed, and
  independent QUALITY plus final-delta SPEC reviews both passed. Source, tests and
  generated output are frozen on basis
  `2fbd8f94c0cd6d7a5cb8b556638a7226b3ccabde1ceab97e7bbdeb6bfa5c3afc`
  for the fresh `wiki-v2-b-final1` exhaustive 32-shard run. Full-regression and
  deployment/publication results remain pending until their own receipts pass.
- B shards 1–19 passed. Shard 20 hit the unchanged 3.5 GiB memory safety stop
  (minimum 3.428 GiB); its report was retained with an `.interrupted-` suffix
  and is excluded from completion evidence, even though its assertions reported
  no failure. All owned test processes were confirmed exited. With free memory
  recovered to 4.946 GiB, the same-basis run resumes from shard 20, keeping the
  thresholds and source unchanged. No user applications or live service stopped.
- Shard 20's fresh run passed 226/226, then shards 21–22 passed. Shard 23 also
  hit the memory stop (3.489 GiB); its owned process tree termination succeeded.
  Remaining coverage now runs one test file per fresh process, retaining the
  same 512 MiB worker heap ceiling, assertions, timeouts and safety thresholds.
  The collector requires every expected file exactly once on the original basis;
  interrupted or unreceipted output cannot satisfy the gate.
- After 375 files passed, the broad `llm-wiki.test.ts` fixture also reached the
  memory stop (3.497 GiB); its owned tree terminated successfully and no result
  from that interrupted attempt is accepted. Remaining files run first, with
  that same required fixture moved last. No assertion or test timeout changes.
- Final B exhaustive coverage passed: **450/450 files, 6311 assertions,
  6307 passed, 4 exact Windows skips, 0 failed/todo/absent files**. The collector
  verified 162 completion receipts on the frozen basis, with no duplicate files
  or unreceipted reports: shards 1–22 plus 140 separate-file reports replace the
  remaining shards. The final `llm-wiki.test.ts` attempt passed all 93 assertions
  (minimum free RAM 3.838 GiB). Minimum RAM among accepted completed runs was
  3.681 GiB; the three excluded safety interruptions are documented above.
  Skips are the existing Windows pipe-path, POSIX-mode and source-file symlink
  checks plus B's file-symlink privilege case. Actual Windows junction/hard-link
  and ACL/replacement tests passed; skipped symlink coverage is not claimed.
  Whitespace and pre-staging content screening passed for the exact 68 B files;
  seven unrelated research files and host data remain excluded.
- B NAS-backed deployment and read-only live acceptance passed on the preserved
  `20260912-wiki-v2-b` release (PID 26656 at verification). All 879 release files
  matched the tested dist before switching. The A release and exact previous
  launcher remain available for rollback. Five fixed tools, grouped boards at
  512/4000 characters, explicit legacy flat output, optional evidence retrieval,
  exact revision reads, active catalog, existing document features and owner
  consent denial were verified live without credentials, model calls or note
  mutations. The actual process has **no `--maintenance-config`**: automatic
  maintenance remains disabled.
- Original/backup/restore bytes remain equal (5 files, 120134 bytes; fingerprint
  `3632c26efcece4a27df8d79227e756445d90fa36d932c75e172a3283a1bf0193`).
  World sequence 2 and economy sequence 1 retain the same canonical byte hashes
  and checkpoints; only verified writer ownership changed. Telnet was not enabled
  and NAS direct-write protection remains outside scope. Staged path, content
  screening and whitespace checks passed. B publication uses these exact 68
  source/test/document/dist files on the user's existing main; no upstream action.
