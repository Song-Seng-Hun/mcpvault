# Axis evolution and bounded initiative implementation plan

Status: implementation, independent reviews, full-suite validation and NAS-backed
deployment verified. Commit/push completion is reported with the delivered commit ID.
Baseline: main at b992261e3dff3c906217f3ca5739b399130f2bbf.
Research: [R01–R25 audit](../research/2026-09-11-axis-evolution-audit.md).

## Authority and operating budget

Implement the approved R01–R25 plan and empty-discussion/benchmark initiative.
Stay on the existing branch; preserve unrelated files, live NAS data, credentials,
world/economy state and rollback artifacts. Only the parent handles shared adapters,
generation/build, deployment, commits and normal pushes to the user's fork. No PR,
release, package publication, force push or new worktree.

User correction after a host crash: memory and token costs are first-class limits.
**No benchmark corpus indexing, benchmark search engine, ingestion catalog, or
per-dataset-item bookkeeping.** Search stays in the existing Wiki. External problem
discovery is a bounded host activity, not a corpus ingestion service. Keep only
selected problem definitions and existing adjudication/payment records. Candidate
suggestions reuse ordinary Wiki capture/links; never introduce a candidate database.
Do not download a dataset/archive, enumerate all problems, embed a benchmark, or
load answers/problem bodies into general search. A link and a short reason suffice
before selection. Existing host execution receipts supply run accounting.

At most one implementation/review worker at a time with a scoped prompt and no
conversation fork. At most one heavy command at a time; all Vitest invocations use
--maxWorkers=1. No overlapping build/test/native indexing. Check free RAM before
heavy work, defer launches below 3 GiB and inspect pressure during long checks.
Use targeted tests while editing; full suite once after integration, repeating only
when a changed source invalidates it. Avoid full generated-guidance reads and large
tool dumps. No blanket timeout increases. No unrelated process termination.

## Delivery slices and acceptance contracts

- [x] R01: revalidate market task/project access before returning rows, counts and cursors.
- [x] R02: one fence-aware evidence locator resolver for publish/lint/packets/change assessment; validate containment, unique blocks and quote hashes without certifying semantic truth.
- [x] R03/R05: one guarded Idea branch creation with exact parent revision and replay key; pin evaluations to source revision and return evaluation locators/current-stale-unpinned state, preserving history.
- [x] R04: Work board/coverage cursors include authorized derived review state; external evidence drift invalidates continuation without hidden-source disclosure.
- [x] R09: normal benchmark close requires a durable decision and all winner payment receipts (also decision for zero winners/reward); human reasoned cancellation preserves issued XP and existing recovery.
- [x] R06: new notes.resolve_link returns exact bounded read actions, fragments and authorized ambiguity; legacy first-pick/ignored-fragment semantics remain bounded with revision, continuation and deprecation. New guidance uses the new contract.
- [x] R07: metadata-first duplicate buckets include stable ID; hydrate bounded candidate pairs only, disclose partial coverage and never auto-merge.
- [x] R10: up to two of the existing twelve retrieval slots for explicitly activated context; unused slots return to regular hits; preserve separate safety/evidence slots and body limits.
- [x] R11: bounded document resource-window continuation distinct from fragment cursor, pinned to authorized catalog/query state; do not skip unprocessed files at byte limits.
- [x] R12: semantic request deadline cancels queued work; surviving shared subscribers continue and running native slots are not released prematurely.
- [x] R08: remote-HTTPS client-only setup without local program/Vault; versioned manifests/confirmation; preserve HTTPS, ownership, backup and drift protection.
- [x] R13: typed operation descriptors derive discovery/alias/read-only contracts from the existing registry; final service authentication/ACL/revision/domain guards remain.
- [x] R14: share explanation eligibility only; keep recommendation priority, WIP, family preferences and explicit-read semantics separate.
- [x] R15: extract only Roleplay hash/revision/ID/account/text kernel; preserve root exports, persisted hashes and rules.
- [x] R16: bounded advisory unreachable prerequisite/exclusion diagnostics; no automatic pruning or invalidation of otherwise legal selections.
- [x] R17: Continuity reports checked/unchecked fields; explicitly selected pending-edit/trail pins can be checked without rewriting saved guards or executing actions.
- [x] R18: explicitly requested original/learning reads may carry current approved explanationAction; never replace originals, expose drafts or bypass source/profile/ACL checks.
- [x] R20: workshop.research field=rounds lists only caller-authorized IDs/phase/revision/status actions within one known Workshop; preserve closed-parent recovery and sealed privacy.
- [x] R19: configuration.learning_preview validates explicit node-to-MOC mappings against current learning routes; save configuration/mapping/source pins through existing Continuity; drift blocks resume, no automatic MOC edits or competency grants.
- [x] R21: historical Skill use references a retained verified version of that Skill; explicit shareable/applied evidence; current promotion inputs still require current-basis application.
- [x] R22: exact human-approved benchmark result revision/fields can produce sanitized Wiki evidence for Skill experience; no answers/sealed submissions/private identities, automatic promotion or repeat rewards.
- [x] R23: explicit committed TRPG turn import to existing Story draft path with exact receipt revision, current room ACL and fictional marking; no wider automatic publication, gameplay/replay/dice/XP changes.
- [x] R24/R25: ignore/staged guard for host data and caches; move duplicated intermediate operator-doc records to execution history without deleting evidence.
- [x] Discussion initiative: reuse enabled participation/initiate/topic/busy/pause/budget/run receipts. Count accessible active substantive posts/Workshops/Ideas even when unchanged/seen; rooms and introduction pins alone do not count. Unknown/partial is not empty. Search existing topics, propose one substantive question/evidence/desired-response post or justified Workshop, allow rest. Recheck emptiness under the existing writer before create so concurrent creators converge on the first topic. Preserve one public action and current account/owner limits.
- [x] Benchmark initiative: host-only absence check distinct from participant visibility; submissions/review/settlement/pending approval or an in-flight host run suppress new collection. Disabled/unconfigured/error is not empty. Use existing session-start/work-completion/approved-heartbeat hooks, never server-side model wakes or new scheduler. Host-wide UTC day: one attempt, five minutes, at most three short candidate links. Count failure/interruption, no catch-up. No login/paid access/code execution/downloads; uncertain reuse rights means link-only hold. Human alone approves opening/pools/deadline/disclosure/XP. Collector and verified same-owner accounts cannot earn/review that problem lineage. Quiet unchanged states, actionable changes only. No separate benchmark indexing or candidate bookkeeping subsystem.

## Verification and handoff

Each slice needs observed RED, GREEN and targeted regression results, then separate
spec and quality review. Use existing real service fixtures with narrowly controlled
IO/race boundaries. Cover auth/read-only/configured matrices, revision races,
replay/payload changes, hidden counts, bounded outputs, paused/busy/exhausted states,
restart/uncertain-result recovery and no unintended network/model invocations.

Final gates: generation check, build, full npm test -- --maxWorkers=1, diff check,
staged path/secret check, generated dist inclusion. Stage exact build hashes; verify
current post-reboot task/process/launcher identity before any runtime change. Deploy
NAS-backed runtime with rollback; read-only endpoint verification and unchanged
world/economy proof. Commit/push existing main to user fork and verify remote SHA.
Report implementation/tests/deployment/activation separately; never invent missing
host approval/configuration or native OS validation.

## Execution record

- Initial inspection: tracked tree clean at baseline; preexisting untracked research,
  .agents, .mcpvault and Python cache preserved. No implementation worker, build,
  test suite or new feature activation had started when the user reported the crash.
- Post-reboot lightweight OS check: total RAM 15.91 GiB, free RAM 5.42 GiB at first
  sample (later 4.72 GiB). Cause of the host crash is not established. CIM OS access
  was denied; Node OS memory readings and process working sets were read instead.
- R24 initial ignore check returned no matching paths; after the rule change all
  three host/cache fixtures are ignored. The staged-path CLI had 3 intended RED
  assertion failures before implementation and 3/3 GREEN tests afterward, with
  --maxWorkers=1 (2026-09-11 16:34 KST). It reads at most 1 MiB of staged names,
  prints no bodies and does not unstage/delete files. Spec/quality review pending.
- R25 historical verification body was compared byte-for-byte (decoded text)
  against the baseline Git version after relocation: identical. Operator guide
  links to the preserved execution section. Spec/quality review pending.
- R03/R05 implementer: one Terra/medium worker with exclusive targeted-test slot;
  service RED/GREEN reported, final adjacent/MCP tests and independent review pending.
- R03/R05/R24/R25: separate static SPEC and QUALITY reviews passed. R03/R05
  adjacent/MCP tests reached 13/13. No final generation/build/deployment claim yet.
- R08: client-only remote setup RED 2, then full portable tests 39 PASS / 1 SKIP.
  Static SPEC passed; QUALITY pending. Native macOS/Linux validation remains separate.
- R10: saturated-candidate RED 3, then review found plain notes were re-sorted
  outside hydration. An end-to-end RED reproduced it; reserved physical-path
  priority now survives packet ordering. Two files / 26 PASS; SPEC passed,
  QUALITY pending. No benchmark corpus or candidate index was introduced.
- R04: external-evidence-only drift accepted old board/coverage cursors (RED 2).
  Fingerprints now include authorized derived rows; targeted 2 and full adjacent
  file 37 PASS. Separate review pending.
- R01: hiding earlier task/project during a later read or final actor check
  returned old market counts/cursors (RED 2 parameterized cases). Scoped observers,
  source revision rereads and final synchronous ACL barrier added; adjacent
  file 8 PASS after the final edit. Separate review pending.
- R15: extracted only the Roleplay value kernel; root exports retained. Golden
  hashes were read from the unchanged baseline dist. RED missing kernel, then
  four files / 38 PASS including root identity and Unicode validator compatibility.
  R16: direct/transitive conflict diagnostics RED 2 and TRPG-row RED 1; shared
  bounded advisory implementation now has three files / 11 PASS. Reviews pending.
- Post-reboot baseline recovery: originating PID10524 absent, scheduled task Ready,
  no 8788 listener. Exact inspection fingerprints and old checkpoint hashes matched.
  Existing deployed recovery functions saved both old locks/inspection audits and
  returned from unlink; economy lock disappeared, but NAS Roleplay writer.lock
  remained listed and independent Node/PowerShell reads returned EPERM/access denied.
  Recovery completion and runtime health are NOT verified; no server restart or
  new feature deployment attempted. No broader SMB reset or unrelated process kill.
  Independent read compared both current checkpoints and canonical file counts with
  recovery audits: unchanged (Roleplay sequence 2, economy sequence 1). User was
  asked to inspect the NAS handle/delete-pending state while local work continues.
- R08/R10 QUALITY passed. R01/R04/R15/R16 SPEC passed; QUALITY found late actor
  revocation, retained skipped-read observations, already-stale review-basis drift,
  and locale-dependent diagnostics. Parent observed three new RED failures and
  fixed them. Existing approval hashes stay unchanged; a separate internal hash
  of authorized review guards pins current pagination. Quality re-review pending.
- R09: normal-close/partial-payment RED 4, then targeted 4 and full adjacent
  benchmark service file 33 PASS. Durable existing award receipts and serialized
  settlement recheck added; human cancellation preserves prior issuance. No new
  settlement/candidate database. Spec/quality review pending.
- R20: MCP round discovery without roundId first failed; authorized minimal IDs,
  phase/revision/status actions added with Workshop-pinned cursors and explicit
  100-record partial coverage. Closed-parent recovery and read-only behavior
  preserved. Research status + independent research: 32 PASS. Review pending.
- R17: explicit saved-entry pin selection and checked/unchecked field report RED,
  then a tiny-response regression found excessive safety-envelope size. Compact
  omission remains explicitly unknown; guards are not shortened. Final targeted
  Continuity files: 27 PASS. Missing guards require guarded-reader ENOENT, never
  a false result that may mean denied access. Review/MCP selection test pending.
- Validation note: bare tsc included test sources and failed on many test typing
  diagnostics; it was not a production build. The actual production command
  `npx tsc --project tsconfig.build.json --noEmit` found one new optional-property
  type mismatch, which was corrected; it then passed. Re-run after later slices.
- Baseline runtime recovery completed at 2026-09-11 17:33 KST: a later read found
  both stale locks absent with unchanged checkpoints. Existing scheduled task
  restarted the unchanged reusable-expansion deployment as writer PID10568 (parent
  16756), listening on 127.0.0.1:8788. Existing read-only live verifiers passed:
  five tools/282 endpoints, cross-axis contracts, configuration kinds, preserved
  legacy world, disabled optional hosts and exact-note read reflex. New writer
  owns both locks; Roleplay sequence 2 and economy sequence 1 and their hashes
  remain unchanged. No extra deletion, SMB reset or unrelated process termination.
  User was told the earlier NAS handle-check request is no longer needed. This
  restores baseline only, NOT deployment of the current working-tree changes.
- Latest integrated slice checks: R01/R04/R16 adjacent three files 50 PASS after
  quality corrections; R20 status/research two files 32 PASS; R17 three files
  27 PASS before an added MCP selected-pin forwarding assertion. Production
  no-emit TypeScript check passed again after all source edits through R17/R20.
- R11: resource-window and byte-boundary RED 2, then document-search 6 PASS.
  Resource continuation is separate from fragment paging, pinned to authorized
  catalog candidates/query/principal, and advances only past attempted files.
- R12: request cancellation RED 4, then cancellation/gate/service 13 PASS. The
  two-second optional deadline aborts queued inference; shared vectors retain
  surviving subscribers. Running native slots still settle before reuse.
- R07: RED 3 (unrelated titles sharing stable ID, hidden candidates, budgets),
  then 3 PASS. Metadata-only buckets; at most 2000 scanned entries, 100 candidate
  pairs and 64 bounded 256 KiB body reads. Partial coverage is explicit; returned
  rows are guarded and similarity never performs a merge.
- R02: shared streaming locator RED missing module, then pure checks passed;
  source-change/question-packet/locator files reached 41 PASS. Existing MCP
  publication/quote/locator regression 1 PASS. New source-change containment
  regression is added and awaiting the next adjacent run. The shared resolver
  does not certify semantics and does not allocate whole-source line/mask arrays.
- R06: new link service RED missing module then 4 PASS; existing MCP wiki_link
  compatibility 6 PASS. New notes.resolve_link preserves fragments/ambiguity;
  legacy first-pick/ignored-fragment previews retain revision and continuation.
  New dynamic endpoint regression awaits the next adjacent run. Guidance updated.
- R09/R17/R20 SPEC passed. QUALITY passed R09/R17 and found unbounded round
  inventory source reads. A new budget assertion failed, then fixed 1 MiB record
  and revision ceilings yielded research-status 15 PASS including a real oversized
  fixture rejected with a generic unavailable error. Quality re-review pending.
- R14: shared eligibility RED missing module, then eligibility/service 22 PASS;
  automatic family preference, WIP and explicit-read differences remain separate.
  R18: approved-action service RED then GREEN; corrected two fixture setup issues
  before observing the actual MCP missing-action RED. Explicit original/learning
  opt-in now passes the MCP regression, preserves original content and pins the
  approved source/job. No draft text is requested. Independent review pending.
- Production no-emit check after these slices found two new duplicate-entry type
  issues, corrected without behavioral edits; it then passed again. No full
  generation/build/full-suite/new-code deployment/commit/push claim yet.
- R19: learning mapping preview/save/resume RED 2 then four adjacent files 31 PASS.
  Explicit source/configuration/mapping fingerprints use existing Continuity;
  drift blocks resume and no MOC edits or competency grants occur.
- R11/R12/R07/R02 QUALITY passed. R20 bounded-record rereview passed. R06 SPEC
  found hidden rows consuming the visible window; RED then five tests passed.
  QUALITY found a hidden-to-visible race; another RED then seven link/tool tests
  passed. Hidden revisions remain internal guards, never output candidates.
- R14/R18/R19/R21 static SPEC passed. R21 historical-use RED current-only rejection,
  then retained original and attested committed version use passed; current-basis
  candidate filtering stayed intact. Separate QUALITY review pending.
- R22: host-only selected result evidence and explicit CLI field/shareable flags
  each observed RED, then a tampered-projection replay RED was fixed. Full adjacent
  benchmark service/CLI files: 38 PASS. Only selected outcome/scores, source pins
  and revision fingerprints are projected; no sealed prose, identities, reward or
  automatic Skill promotion. Static review pending.
- R23: actual file-backed TRPG-to-Story import RED unknown field, then targeted
  integration PASS. Exact single committed receipt projection avoids cloning a
  whole world; existing guarded Story draft writer pins turn and room, rechecks
  room on retries, and leaves world revision unchanged. Adjacent/MCP/review pending.
- R23 adjacent Story/Roleplay tests: 43 PASS. Actual TRPG import and R19 authenticated
  read-only learning preview MCP checks: 2 PASS / 4 SKIP. R02 containment, R06 new
  endpoint and R17 selected-pin MCP checks: 3 files / 12 PASS / 71 SKIP.
- R14/R18/R19/R21 QUALITY passed. R22/R23 separate SPEC and QUALITY passed.
- R13 typed mixed-operation descriptors: missing shared alias RED, then three
  contract/Story/Skill MCP files 6 PASS. Discovery and both dispatch gates use the
  same operation table; existing service guards remain. Separate SPEC/QUALITY passed.
- Discussion initiative: missing fresh absence and duplicate concurrent creation
  RED 2, then full participation/candidates/retry/protocol files 30 PASS. Review
  found terminal workflow status and loser recovery gaps. RED 2 reproduced them;
  canonical terminal statuses plus explicit revision-safe skip-then-pulse recovery
  now pass both regressions, preserving one public topic and consumed budgets.
- Benchmark initiative: global absence/collector provenance RED 2; host adapter
  RED 3; host CLI/global binding RED 2. Initial five-file adjacent run: 99 PASS.
  Additional public-owner leakage, omitted retained version and final source-drift
  regressions each observed RED and were corrected; targeted 3 PASS. No corpus or
  candidate database was added. Actual host collection remains unconfigured until
  an existing durable-receipt/search/capture adapter is supplied; no scheduler or
  automatic live benchmark activation is claimed.
- Production no-emit TypeScript check after R13 and both initiative implementations
  passed. Final generation/build/full-suite/deployment/commit/push remain pending.
- Guidance generation exposed a copied R03/R05 error ID with different wording;
  the new evaluation error now gets its own generated ID. Generation/check and
  production build passed. A post-generation nine-file integrated run: 123 PASS.
- Discussion QUALITY closure: generated stable error IDs verified; a requestless
  coordinator regression observed RED with the old bypass and GREEN with shared
  serialization. No private/public activity was created outside temporary tests.
- Benchmark SPEC found reverse-direction lineage provenance: an omitted retained
  participant could become a later collector. Real-file RED reproduced opening;
  union checks now cover every retained same-lineage pool, and current owner
  binding must be available when collector exclusions exist. Three adjacent
  files: 93 PASS. The first full-suite attempt was explicitly interrupted after
  this finding, before source edits; it is not a passing full-suite result.
- Final Benchmark review found a cross-instance A-to-B source race overwriting
  an earlier guard. A separate real FileSystemService reproduced the false empty
  result (RED). Canonical-path pins now retain the first revision and reject any
  conflicting pin as unknown. Direct collector, different-account same-owner and
  missing retained-profile cases have independent fixtures/diagnostics. Latest
  five-file benchmark regression: 105 PASS. Separate SPEC/QUALITY rereviews passed;
  Discussion QUALITY also closed. Final guidance generation has 4915 entries.
- Deployment candidate copied 825 files with the current launcher preserved.
  Read-only preflight verified all candidate hashes and unchanged NAS world/economy
  checkpoints. Subsequent reviewed fixes require refreshing that candidate after
  the final build; this is not deployment completion. The initial script-policy
  error was a 32-bit inspection-shell mismatch: the existing scheduled task uses
  64-bit PowerShell, whose existing policy permits startup. No execution policy or
  task setting was changed. Final generation/check/build/full-suite is in progress.
- Final guidance check passed with 4915 entries and zero source changes; production
  build passed. The source is frozen while the single-worker full suite runs.
  Exact-file staging contains 237 changed files; staged-path and whitespace checks
  passed, with no high-confidence credential-pattern matches in added content.
  Six preexisting September 9 research documents and all ignored host/cache data
  remain outside the commit. Directory-wide staging was rejected by the safety
  gate and replaced with an explicitly verified individual-file manifest.
- First completed full suite: 408 files passed, 2 failed; 5571 tests passed,
  3 failed, 3 skipped in 1493.08 seconds. Failures were the bootstrap size
  (9057 versus 9000 characters) and two retrieval-policy assertions: new exact-link
  prose displaced the later semantic-safety rule at a 4000-character response.
  Only the new staged-check prose was shortened (8981 characters; LF is pinned).
  The unchanged semantic rule now follows lexical safety before navigation prose.
  An assertion keeps exact-link guidance and semantic safeguards together within
  4000 characters. Both failing files now pass all 27 tests. Regeneration/build
  and a fresh complete single-worker suite are required before deployment.
- Final wording review restored explicit post-staging order and staged-content
  secret inspection within 8997 characters. Independent final review passed.
  This supersedes the intermediate pending/failed records above without erasing
  their evidence. All checked delivery slices denote implemented, tested contracts;
  they do not imply optional host activation or native validation on other OSes.
- Final complete suite: 410 files PASS; 5574 tests PASS, 3 SKIP, zero failures,
  in 1485.34 seconds (`npm test -- --maxWorkers=1`). Generation/check (4915 entries,
  zero source changes), production build and whitespace checks passed. Free RAM
  stayed above the 3 GiB launch floor; no parallel heavy commands were used.
- NAS-backed deployment completed 2026-09-11 20:34:41 KST as writer PID22344.
  All 825 staged dist files and package matched the final build. Exact old server,
  parent, listener and scheduled-task identity were checked before replacement.
  The only launcher change was the immutable deployment entry; task and host
  configuration stayed unchanged. Previous release and launcher backup remain
  under the ignored deployment directories; no Vault data was reset or replaced.
- Read-only live acceptance passed: five fixed tools, 284 endpoints, six catalog
  pages, eight representative queries; exact revision-pinned links, original-read
  preservation, resource/pin continuations, authenticated learning-preview gating,
  advisory graph and mixed-operation schemas, explicit import/initiative schemas,
  and semantic safety plus exact-link guidance within the 4000-character policy.
  New writer owns both locks. Roleplay sequence 2/two turns and economy sequence
  1/one journal retain the exact pre-deployment checkpoint hashes; no gameplay,
  rewards, registration, public posts or model calls were performed by verification.
- Activation boundary: external benchmark collection remains unavailable without
  a trusted host adapter for existing durable receipts, bounded link search and
  ordinary Wiki capture. No benchmark corpus/index/candidate database, new scheduler,
  automatic contest opening or optional model/provider activation was introduced.
  Collector lineage/owner exclusions and absence guards are covered by isolated
  tests; the live optional benchmark host remains disabled. Native macOS/Linux
  installation was not executed on this Windows host.
