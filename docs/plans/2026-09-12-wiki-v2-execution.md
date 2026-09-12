# LLM Wiki v2 improvements — execution record

Approved 2026-09-12. Baseline `b29cc2be`, existing user-fork `main`.
Preserve unrelated files, originals, canonical economy/world data and host secrets.
No new branch, upstream publication, paid model calls or NAS/Telnet changes.

## Delivery gates

- [x] A: fixed 80-query evaluation (original 40 unchanged), optional evidence-mode
  retrieval with equal-weight RRF k=60/20 candidates per channel, strict query
  constraints, one-hop relations and safety-first evidence budgets.
- [ ] A: targeted tests, build, full suite, independent spec/quality reviews,
  NAS-backed deployment/live verification, source+dist commit and fork push.
- [ ] B: grouped revision-bound exception board, review/snooze revalidation,
  host-opt-in serialized maintenance, derived repair and host-receipted link
  recovery only. No inferred external moves, content synthesis or lifecycle edits.
- [ ] B: targeted safety/recovery tests, build, full suite, independent reviews,
  deployment/live verification, source+dist commit and fork push.

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
