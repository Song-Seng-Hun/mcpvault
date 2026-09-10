# Sequential execution record

User authorization: implement Plan 1 then Plan 2, with verified NAS runtime deployment, commit and push on the current branch. No new branch/worktree, upstream PR, package/release publish or force push.

Baseline: `ad7db84c` on the user's fork `main`. Unrelated `.agents/`, `.mcpvault/` and six existing NAS research documents are preserved and excluded from commits.

## Plan 1

Contract: [Context economy](2026-09-10-context-economy.md).

- Status: native-PDF, opt-in OCR and document implementation deployed and live-verified.
  Source delivery is recorded by the containing Git commit. This does not close the remaining OCR benchmark
  and context-economy evaluation gates below. Markdown/text
  structure, revision-pinned reads, resource manifests/exports, context/search
  integration, neutral RAG adapters and progressive guidance are implemented.
- Optional PDF worker and Windows broker are implemented. Approved PID-only
  Microsoft debugger tracing identified
  `KERNELBASE!ConsoleAllocate` returning `0xc000049d` during `ConsoleInitialize`,
  causing `DLL_PROCESS_ATTACH` failure and `worker_abnormal_exit_c0000142` before
  Python. Replacing hidden-console creation with `DETACHED_PROCESS` preserves
  AppContainer, Job and child-process restrictions; the separate diagnostic build
  passed data-free `--check` (exit 0) and verified cleanup. After two approval-policy
  rejections, the user explicitly approved this exact host backup/replacement.
  The production host was replaced, and its non-debugger `--check` passed (exit 0)
  with profile/ACL/job cleanup verified. The original host backup is retained.
  No unrestricted document fallback is allowed. The later `input_unavailable`
  was confirmed as ungranted ancestor metadata inspection, not file read denial.
  Native host-owned roots now bound worker checks; host canonical ancestor pins,
  root-inclusive reparse checks, source fstat/hash and model checks remain.
  Root arguments cannot be injected through the host allowlist. No ancestor
  permissions were broadened. Native bilingual and column/table fixtures passed;
  the scan fixture explicitly reported unavailable OCR. Actual OS network/file/
  runtime-write/child-process denial probes and lifecycle cleanup passed.
- Build passed. Initial full suite: 4838 pass, 8 fail, 2 skipped; fixed protection
  error priority and guidance-budget regressions, with targeted reruns passing.
  The MCP roleplay integration passed an isolated rerun (4680 ms), but timed out
  again with two workers (5063 ms / 5000 ms limit). An archived, unchanged
  `ad7db84c` baseline reproduced the same timeout (5036 ms) under current host
  load. No timeout or assertion was weakened. Final full two-worker rerun:
  **360/361 files pass; 4854 tests pass, 1 timeout, 2 skipped** (594.78 seconds).
  The only failure is that baseline-reproduced roleplay timeout. Build and
  `git diff --check` pass. This is not an all-green test claim.
- PDF admission/lifecycle: 12 mock tests pass; nested protected-child/hardlink
  pre-mutation rejection and inherited-grant regressions pass. Independent scoped
  Node lifecycle review passed, **not** OS/extraction certification.
- Python worker unit tests: 32 pass. Progressive document-reference scenarios
  and compressed AGENTS authority preservation received independent review.
  Bootstrap files keep LF via narrow `.gitattributes` entries, making budgets
  and YAML checks stable across Windows checkouts.
- The fixed corpus has 100 synthetic text queries plus 21 PDF-fixture queries.
  Real OCR/Tesseract and same-answering-model quality/cumulative-input comparisons
  are not complete. No >=30% saving is claimed; legacy defaults remain.
- Microsoft WinDbg 1.2606.22001.0 installation and data-free child-only diagnosis
  were explicitly approved and completed. Loader snaps were process-local only;
  no IFEO/WER registry changes, broad system trace or real PDF input were used.
  The new creation-flag contract failed against the old flag and passed against
  the fix. Production compilation omits the diagnostic hook. Build and targeted
  PDF tests (24/24) passed. Fresh full-suite rerun: **361/361 files passed;
  4855 tests passed, 2 skipped** (608.98 seconds); no timeouts or assertions changed.
- Final native host SHA-256:
  `c664896253608f3aed3d21592202742ac0bcf65d6b3e8459905d9126ccae6c25`.
  Original executable and pre-root-change host/worker backups are retained.
- Latest full one-worker regression: **361 files passed; 4855 tests passed,
  2 skipped** (1228.06 seconds). Final build, guidance check, Python tests and
  diff check passed. Independent root-boundary and deployment reviews found no
  remaining blockers in those scopes.
- User's follow-up explicitly requested fixing/enabling PDF and NAS deployment,
  commit and push. Native-only PDF opt-in is now deployed on the existing NAS-
  backed runtime; 747 staged dist files were hash-verified. Previous release and
  launcher are retained. Exact old writer exit, audited lock recovery and unchanged
  world/economy checkpoints were verified. Authenticated live MCP verified five
  fixed tools, bilingual PDF/negation text, both original page boxes, document
  search, stale revision rejection and full original-byte export equality across
  six bounded calls. Existing roleplay and skill functionality remained enabled.
  Delivery uses the existing `main` and user fork, with no upstream PR, release
  publication or force push. That native baseline did not claim OCR, measured
  savings or completion of both plans.
- Later explicit OCR activation and 2048 MiB operator-budget approval: local
  Korean PP-OCRv5 scan verification passed all five critical sentence bodies
  with expected image-line coordinates under the real AppContainer provider.
  Default/native-only budget remains 1024 MiB and the deadline remains 120s.
  Incorrect v4 direction-classifier rotations are disabled; scan-only full-page
  OCR is separated from mixed-page PDF-first merging. `0/o` and spacing errors
  remain, and upside-down recovery is not supported. Native/column-table and
  actual OS denial/cleanup checks passed; Python 33 and Node PDF 25 tests pass.
  OCR runtime cutover preserved all world/economy checkpoints and journal files;
  authenticated live MCP verified scan outline/read/search, all five critical
  sentence bodies, page boxes and the expected OCR profile. Both native and scan
  originals were exported byte-identically over 12 bounded calls. Existing
  roleplay/skill health remained enabled, and rollback artifacts are retained.
  Full four-worker run: 4854 pass, 2 timeouts, 2 skip across 361 files. Both
  timeout files passed all 8 tests on a one-worker rerun with unchanged assertions
  and timeouts. Final guidance/PDF rerun passed 38 tests; build and catalog check
  passed. Catalog regeneration changed only three source-line locators.
  This does not satisfy the Tesseract or same-answering-model economy gates.

## Plan 2

Contract: [Context-aware collaboration](2026-09-10-context-aware-collaboration.md).

- Status: queued; do not implement before Plan 1 is delivered.
- Verification/deployment/commit: pending.
