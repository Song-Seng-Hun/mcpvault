# MCPVault complexity refinement

## Contract and baseline

Approved scope: preserve existing knowledge, collaboration, Work, Story,
Roleplay, economy, Skill and enterprise use cases while removing duplicate
contracts, state, implementations and navigation. Do not add an orchestrator,
service, index or configuration framework. Markdown, revision-pinned evidence,
access checks and settlement invariants remain authoritative.

Baseline commit: `b2c14dfd4921871705b5c1a0fec869d38677f24d` on the user's `main`.
Tracked files were clean; pre-existing untracked operator material is excluded.
The eight preceding commits added/deleted 7,965/153 handwritten `src` lines;
tests, generated guidance, `dist`, documentation and other files are separate.
The isolated default registry had 269 endpoints behind five fixed MCP tools.
At 20,000 characters, the old full listing returned 11 without a cursor.
`knowledge search` returned only `wiki.knowledge_gaps`; `review my work`,
`지식 검색`, and `작업 이어서` returned no results. These are fixture observations,
not production usage or model-latency measurements.

Removal rules, in order:

1. Equivalent behavior/access with verified replacement: migrate then remove.
2. Useful but unconfigured: reduce discovery exposure, retain status probes.
3. Test/evaluation/operational-only: keep with its actual consumers.
4. Unknown meaning or consumers: investigate; do not infer disuse.
5. Distinct authority/evidence/settlement semantics: retain and document why.

Legacy API transition: migrate controlled callers, deploy and verify once,
then remove the thin compatibility path in the next refinement unit. No
permanent duplicate implementation or unfinished temporary alias at closure.

## Work ledger

| ID | Change / retained value | Classification | Replacement / owner | State |
| --- | --- | --- | --- | --- |
| R01 | Pulse public/internal schema drift, repeat notices | Merge duplicate contract | Existing pulse tool definition and caller revision receipts | Verified NAS deployment and fork push ebf45d87 |
| R02 | Answer claims incorrectly use summary bullets | Merge duplicate projection | Structured claim projection; summaries stay distinct | Verified NAS deployment and fork push ebf45d87 |
| R03 | Broken website command | Repair dead entrypoint | Existing `website-shibumi` app | Verified build and fork push ebf45d87 |
| R04 | Economy simulation and question corpus in production build | Move evaluation assets | Test fixtures, preserving all evaluations | Targeted tests and fresh build passed; absent from staged release |
| R05 | Capability search, schema budgets, listing continuation | Reduce navigation | Existing five tools, exact-ID schemas, bounded catalog pages | Verified NAS deployment and fork push ebf45d87 |
| R06 | Unconfigured host operations advertised ready | Reduce exposure | Operation-level configured/auth/data status | Verified NAS deployment and fork push ebf45d87 |
| R07 | README repeats schemas and long feature references | Prune documentation | Short guide to existing executable schemas and topic docs | Guide/route tests and fork push ebf45d87 |
| R08 | Closed Workshop strands independent research | Repair terminal path | Authorized unresolved closure; embargo remains | Verified NAS deployment and fork push; formerly missing independent review now passed |
| R09 | Work handoff invalidates Story writer | Reconcile ownership | Explicit showrunner resume using accepted Work revision/generation | Verified tests, independent reviews and refinement-2 NAS deployment; fork receipt below |
| R10 | Workshop task output loses caveats | Preserve accepted contract | Existing Work description/context, no output database | Verified tests, independent reviews and refinement-2 NAS deployment; fork receipt below |
| R11 | Story/Quest results lack precise Work completion handoff | Reuse workflow | Existing Work packet with exact evidence; no automatic approval | Verified tests, independent reviews and refinement-2 NAS deployment; fork receipt below |
| R12 | Synthesis basis checking absent during reuse | Reuse existing check | Projection and Answer/Context packets | Verified NAS deployment and fork push ebf45d87 |
| R13 | Investigation review cannot distinguish reviewed results | Reconcile review evidence | Existing note/claim review records, result revision binding | Verified tests, independent reviews and refinement-2 NAS deployment; fork receipt below |
| R14 | Bridge candidates trapped in alphabetical sample | Share candidate selection | Authorized common retrieval, bounded partial-result continuation | Verified tests, independent reviews and refinement-2 NAS deployment; fork receipt below |
| R15 | Application feedback underused by review/reuse | Reuse reverse references | Existing application records, no automatic contradiction | Verified NAS deployment and fork push ebf45d87 |
| R16 | Packet/health/dashboard overlap | Retain distinct contracts | Existing shared projections/collectors; comparison below | Compared implementations, authorization and consumers; no additional equivalent endpoint approved for removal |
| R17 | Duplicate MOC status read on the mutating region endpoint | Migrate then remove | Canonical wiki.moc_region_status | Verified tests, independent reviews and refinement-2 NAS deployment; fork receipt below |
| R18 | Merged skill-evolution branch | Remove merged refs only | Verify ancestry, remote tip and no checked-out worktree | Removed local/remote refs; merged code remains in main |
| R19 | Enterprise support differs from general launcher | Clarify boundary | No automatic optional-host enablement | Verified NAS deployment and fork push ebf45d87 |
| R20 | Enterprise import stops after one page | Reuse host continuation | Bounded sequential pulls, explicit partial/conflict/stall result | Verified tests, independent reviews and refinement-2 NAS deployment; fork receipt below |
| R21 | Whole-system repeat audit | Re-evaluate all axes/seams | Two consecutive change-free complete passes | Two complete change-free passes; same 1001-input fingerprint |

Explicitly retain resource-bundle host, skill-library host and Roleplay
recovery: they have script consumers. Preserve independent meanings of
Memory/Continuity/source reads, capture/immutable evidence, deliberation/Work
review/editorial judgment, reputation/wallet/game money and Global sync/public
federation/company memory. File splitting alone is not a measured improvement.

## Verification and deployment gates

- [x] Baseline full suite in an isolated fixture environment.
- [x] Regression first: red result recorded before behavior changes.
- [x] Targeted tests, build, full tests, guidance consistency and diff checks.
- [x] Specification review, followed by independent quality review.
- [x] Preserve prior release and operator launch configuration for rollback.
- [x] Deploy runnable batch; verify actual MCP and read-only NAS scenarios.
- [x] Commit source and corresponding generated output together; push user fork.
- [x] Retire migrated compatibility paths only after the transition deployment.
- [x] Recheck every ledger item and complete two change-free audit passes.

Commands: `npm test -- <target> --maxWorkers=1`, `npm run build`,
`npm test -- --maxWorkers=4 --testTimeout=15000`, `npm run guidance:check`,
`git diff --check`. The explicit test timeout is the same command-level budget
used by the previous verified release; assertions are not weakened.

Required scenarios: unchanged/changed notice receipts; Korean/English discovery;
exact-ID schema; paged catalog with authorization/configuration drift; missing
host versus access versus missing data; claims without summaries; changed or
hidden synthesis inputs; investigation review and later substantive drift;
bridge outside the old sample; closed research and concurrent closure; accepted
Work handoff and Story resume; caveat preservation; exact Story/Quest handoff;
hidden-count and stale-revision rejection; idempotency; legacy data reads;
more than 100 import entries, conflict, interruption, resume and no-progress.

Mutating behavior is verified in disposable fixtures, not the live Vault.
Deployment rollback switches runtime only: never rewind world/economy data,
credentials or Vault documents using Git. Never commit private operator files.

## Outcomes

First-unit work in progress (not a deployment claim): baseline passed 363 files,
4,966 tests with two skipped in 459.68 seconds. Pulse/build-boundary regressions
first failed for the four expected defects, then all 23 selected tests passed.
Discovery regressions first failed six cases; after changes, the combined main
scope passed 65 tests in six files. They include complete catalog traversal at
512/2,000/12,000 characters and callable exact schemas for all 269 endpoints.
MCP projection drift compaction failed before its fix and then passed within
the 29-test knowledge/control integration run.

Knowledge reuse initially passed its 26 new regressions and 99 nearby tests;
independent specification review passed. Quality review then found a deferred
cross-validator visibility race and Claim payloads displacing opposing context.
Both require correction before acceptance. The first build also rejected an
explicit undefined optional principal. No rollout or fork push is claimed for
this unit until these findings, fresh build and the full suite are cleared.

The first integrated full suite found two regressions: 5,012 passed, two failed,
two skipped in 367 files / 523.44 seconds. An Answer packet lost a counterpoint;
the REST test also assumed the entire catalog fit its first page. Its replacement
traversal exposed a missing cursor forwarding field in the REST adapter. Review
additionally reproduced escaped guidance exceeding a 512-character envelope and
administrator setup incorrectly disabling a permitted Roleplay preview. These
three discovery/adapter regressions failed before correction, then all 56 tests
in the capability/REST/control-plane run passed. Knowledge repair remains gated.

The knowledge regressions were then corrected: all 204 tests in six files,
including all 93 original LLM Wiki tests, passed. Independent quality review
also checked ten in-memory cases covering late source/ancestry revocation,
448-character paths, whole-Claim budgets, exact recovery bindings and preserved
counterpoints. Main/discovery quality review passed after its three repairs.

R08 added two red-first tests and passed 25 nearby tests. Only the existing
facilitator may close an existing round unresolved under a closed parent;
submission/disclosure/synthesis remain blocked. R10 first failed three actual
output/recovery scenarios and the oversized-description case, then passed 28
tests. Existing Work descriptions and packets now retain all accepted caveats;
oversized assembled descriptions fail before reserving output, not after losing
conditions. No independent truth, approval or execution permission is inferred.

Review limitation: the separate reviewers hit the account usage limit after
R08 specification review and before the added R08 quality / R10 specification
and quality passes. Main directly re-read those small changes, guarded writes,
reference validation and tests and found no blocker. This is explicitly not an
independent-review claim. No additional workers, paid credits or resets were
started to bypass that limit.

First-unit diff measurement before the final ledger update: handwritten runtime
238 added / 80 deleted (net +158), tests 641/10, generated guidance 773/846,
`dist` 1,083/1,272, documentation 410/4,751, configuration 1/1. Evaluation assets
251/250 are relocation and excluded from the runtime reduction claim. Runtime
growth repairs lost Claims/counterpoints, deferred visibility races, unavailable
catalog tails and stranded cleanup; it adds no durable receipt/index/service.
The fixed tools remain five and endpoint IDs remain 269. Pulse's three existing
internal inputs are now public; listing adds one cursor. The one MOC status
operation remains temporary until its verified transition deployment.

R18: remote `main` was `b2c14dfd4921871705b5c1a0fec869d38677f24d` and the local/
remote skill branch was `2695eb58cb2564e0ee5970f55a8c07a42f129302`. Ancestry proved
the latter was already merged; no worktree checked out that branch. Ordinary
remote deletion and `git branch -d` removed only those refs. A subsequent remote
read confirmed `main` unchanged and the skill branch absent. The retained commit
in `main` remains the recovery point; no feature code or worktree was removed.

README detail is routed to existing schema/topic contracts; unique Global Sync
operating instructions moved into the existing enterprise deployment guide.
The 250 fixture lines moved out of `src` are evaluation relocation, not a claim
that 250 lines of runtime algorithms were simplified. Six obsolete generated
fixture files were removed; all remain recoverable from Git.

Verified removal candidate: `wiki.moc_region` operation `status` already rewrites
to the exact `wiki.moc_region_status` handler before authorization, including
read-only calls. Both use the same MOC service status projection. Normal fixture
callers and schema/Obsidian guidance now select the canonical read; a dedicated
transition test checks identical public, hidden and private-target behavior.
Keep only the existing forwarding branch through the first NAS deployment;
the next unit removes its public option, adapter exceptions and transition test.
The service's internal status operation remains the single implementation used
by the canonical read; it is not obsolete compatibility code.

### Verified first transition unit

Fresh build, guidance consistency and diff checks passed. The final full run
passed 367 files / 5,026 tests, with two skipped (458.47 seconds). No source or
test changed during that run. The staged 747-file release matched source output
by hash. On 2026-09-10 the NAS-backed process switched to the refinement-1
release; previous runtime and launcher remain preserved for rollback.

Actual read-only MCP verification passed: five fixed tools, all 269 endpoints
enumerated exactly once over five 12,000-character pages, eight Korean/English
primary queries, full exact-ID schema, unchanged welcome receipt, canonical
MOC status and its temporary alias returning the same result. Roleplay and Skill
remained enabled. World sequence 2 and economy sequence 1 retained the exact
pre-deployment canonical hashes; no Vault, task, world or ledger test mutations.

Commit `ebf45d8709c19083bb4cf51ee4e92eeb6cb82885` is verified at local HEAD and
the user's remote `main`. Pre-existing untracked operator/research files remain
excluded. This verifies the first deployment for R01–R08, R10, R12, R15,
R19 and R17's transition only. R17 alias removal is now eligible in the next
unit, not complete. R09, R11, R13, R14, R16, R20 and both final audits remain.

### Second refinement unit in progress

The previously quota-limited R10 specification review was completed in this
unit and found a Unicode counting mismatch: the assembled task preflight used
code points while Work uses UTF-16 length. A supplementary-character regression
failed before reservation as expected only after replacing the duplicate check
with Work's existing `textField` validator. The Decision context contract is
different and remains unchanged. This removes a validation disagreement rather
than truncating accepted caveats or weakening the Work limit.

R14 now asks common retrieval over the authorized search space before retaining
candidate metadata. It preserves the 64-metadata/eight-body bounds and existing
fallback; bounded discovery stays explicitly partial and continues to normal
search rather than repeating the same sample. It adds no index or model router.

The first main whole-system pass added an actual Search/Collaboration/Retrieval
integration fixture beyond the stubbed admission test. It reproduced an empty
candidate list because `searchContent: false` also left Properties search off
by default. Explicit `searchFrontmatter: true` now preserves metadata matching
both in Bridge discovery and its ordinary-search continuation. Omitted and
explicit queries find the methods-only match beyond 70 alphabetically earlier
notes; Community candidates remain excluded. All 29 Bridge/Work tests passed.
The in-progress full run was intentionally cancelled before this fix; it is
not a verification receipt. Consecutive change-free audits reset to zero.
Independent quality review then reproduced configured retrieval collapsing
outward discovery to near-only hits. To preserve the prior two-near/one-distant
scenario, outward requests for three leads reserve eight slots inside the same
metadata budget for an additional bounded common retrieval of contrasting
authored domains. Search matches alone do not classify these contrast hits as
near; current domain/relationship evidence still determines the lane. Partial
search remains explicit. The real configured-retrieval regression failed before
the fix, then all 30 Bridge/Work tests passed. This adds no path-first inventory
sample, index or state and keeps 64 metadata/eight body limits. The full run in
progress was cancelled before editing; audit streak remains zero.

R20 continues the existing replica pull with at most ten 100-entry pages. It
distinguishes completion, budget exhaustion, conflict, no progress and interrupted
I/O; the persisted cursor remains authoritative. A failed page does not pretend
its applied list is complete. Signed 101-entry import, conflict preservation,
partial restart, interrupted restart and nonterminal empty responses passed.
TLS is validated before import, and startup logs the actual synchronization state.
Independent specification review also identified a checkpoint-write failure
leaving the same replica object's in-memory cursor ahead of disk. A red-first
fixture reproduced the skipped retry entry. Interrupted imports now invalidate
only in-memory state so the next existing load reads the durable checkpoint.
Failures before the first checkpoint and after one saved entry both recover;
all 42 import/Global Sync/Enterprise tests passed. No Vault rewrite or new
recovery store was introduced. The second pre-final full run was cancelled
before this fix and is not counted as verification.

R09 exposes only an explicit resume option with exact Work revision/generation.
It verifies an accepted handoff from the prior writer, the new assignee's current
membership and showrunner authority; source/editor history is retained. Ordinary
resume cannot silently change the writer. R11 retains exact decision artifacts
in the existing Story session result and derives the Work handoff on read; settled
Quest results remain in the existing paid projection with visible pinned sources.
Neither domain changes Work status, verification or approval automatically.

R11's first implementation misread raw file results as including a path; final
input revalidation consequently dropped both result projections. The fixture
packet exposed this cause. Keeping the exact input path alongside each observed
revision fixed all five result cases, and the fresh build passed. Expanded
visibility/concurrency regressions then passed all 156 tests in six files,
including one-winner reconnection and hidden settlement/Story evidence. R13,
full verification and rollout remain.

R13 adds an optional exact `investigationEvidence` reference to existing note
and Claim review contracts. It records the current reported-result revision
and a semantic target basis inside the existing review Properties, preserving
ordinary review metadata updates without inferring completion from old unlinked
reviews. Substantive body/claim/relation changes, changed result revisions and
changed/hidden evidence require reassessment. The related-note CAS writer,
scope checks and immutable-source rules are reused; there is no approval store.
Four first failing cases became green; later failure/visibility/drift cases
passed. Specification review identified duplicate metadata reads for repeated
prose references: a red-first test proved two reads instead of one, then an
access-checked request-local cache fixed the duplicate while retaining final
revision guards. The complete 31-test file passed after this correction.

### R16 contract comparison

All reads below use the caller's scope predicate; similarity of names does not
make their response meaning or continuation contracts equivalent.

| Family | Preserved output/consumer | Existing shared calculation / reason retained |
| --- | --- | --- |
| Answer / Context | One-note evidence/claims/contradictions versus MOC reading order and a live shelf | `contextPack` calls `answerPacket`; both reuse `readProjection`, synthesis/application validation and final revision checks. Context's additional traversal requires its later revalidation. |
| Review queue / dashboard / packet | Evidence/lifecycle review candidates versus Reflect's sectioned inventory versus prioritized next action | `collectReviewQueue` feeds the queue and `collectReviewDashboard`; the dashboard collector feeds `reviewPacket`. Pulse calls the packet, not all three endpoints. Different response budgets and attention/snooze behavior remain. |
| Graph / organization health | Relationship/MOC connectivity versus property/lint, quarantine and collection repair | Graph health is consumed by Reflect and review packet; organization health reuses `lint` and `CollectionHealthProjection`. A missing graph sample can require a larger bounded read; this is a budget continuation, not a second implementation. |
| Flow / next actions / project packet | WIP/dependency forecasts versus executable actions versus one project's completion context | All use `workDependencySnapshot`; shared resolution and cycle classification remain single implementations. Different thresholds, body requirements and returned evidence are not aliases. |
| Work packet / knowledge review packet | Authenticated assignment/review/completion versus advisory knowledge maintenance | Work role authority and task generation cannot be inferred from knowledge health. Story and economy contribute evidence to Work, never automatic approval. |

The MCP adapters still dispatch these distinct operations; `agent-pulse.ts`
uses the single maintenance `reviewPacket` route. The inspected pairs already
share their business calculations rather than maintaining parallel state.
No name-only merge, file split or new cross-request cache is warranted. The
proven equivalent MOC-region status alias follows R17's deployed transition
and removal; that is the only additional public-path deletion in this unit.

Report each unit's retained value, removed complexity, handwritten-source
additions/deletions, separate tests/generated/docs delta, verification and
remaining transitional paths. Source growth for a defect fix must name the
failure path removed; deleting tests/safety checks or compressing formatting
does not count. Representative prepared-session tasks must reach the correct
execution path within three discovery/read calls, excluding required approvals
and original-evidence inspection.

Completion requires all known defects resolved, all core scenarios preserved,
no approved removals or temporary aliases left, a reason for retained
complexity, two complete change-free audits and final verified deployment plus
fork push. Any implementation change resets the consecutive audit count.
Unknown external consumers or missing authority remain explicit blockers,
never silent completion. No whole feature island is presumed unused.

## Final audit record

Following the metadata-read, real retrieval, contrast-lane, checkpoint-retry
and Unicode-preflight corrections, specification and independent quality
reviews passed. The formerly incomplete R08/R10 independent review gates were
also completed; their earlier limitation remains historical, not an open gate.
Target receipts include 156 cross-domain, 133 knowledge/review/control, 30
Bridge/Work, 42 Global/Enterprise and 47 Workshop/independent-research tests.
Fresh guidance generation (4,470 entries, zero pending bindings), build and
guidance check passed before the final full-suite run.

### Complete pass 1 — main audit, 2026-09-10

Reconciled the original inventory, every ledger row, live deployment profile,
remaining callers and the ten axes below after the last implementation fix.
No additional unhandled value-preserving removal or broken seam was identified.
The 1,001-file audit snapshot is
`f87a3cd3f280fe3da373c5a82e6e17bb64b20c6afd08ef8a326b1748c4ad64d3`.
It includes tracked source/tests/contracts plus the new import regression;
excludes generated dist/guidance, research receipts and the unchanged companion
website. Generated artifacts are checked separately by build/stage hashes.

| Axis and seams revisited | Retained requirement / disposition |
| --- | --- |
| Data/trust → every domain | Normalization, PathFilter, scope predicates, immutable sources and revision guards stay authoritative. Review receipt paths join move/delete integrity, not graph support. |
| Capture/evidence/knowledge → reuse/review | Claims are separate from summaries. Synthesis/application drift checks feed reuse. Investigation receipts suppress only repeated review; drift/hidden evidence remain actionable. |
| Retrieval/organization → packets/maintenance | Primary intent routes and exact schemas remain accessible; catalog is paged. Bridge uses common primary/contrast retrieval with explicit partial coverage. R16 records distinct retained views. |
| Memory/continuity/guidance → session work | Private memory is not public knowledge; continuity retains exact pending-edit/learning guards. One pulse schema and caller notice revisions replace duplicate/reminder paths. |
| Community/Workshop/research → decisions/Work | Legacy discussions stay history. Closed parents allow only authorized unresolved research cleanup. Accepted caveats survive Work creation under the same downstream validator. |
| Work → Story/Quest/completion | Work owns accepted assignment and generation. Explicit reconnect and exact result locators bridge domains; Work completion/independent review are not inferred. |
| Story/Roleplay → evidence/Skill/Quest | Writer/editor/showrunner stay distinct. Fiction/adoption is not factual approval. Host administration and recovery remain explicit, with operational script consumers. |
| Economy/Quest → Work | Host owners, escrow, idempotency, conservation and signed private receipts remain distinct from reputation or narrative money. Settled results hand off evidence, not automatic Work approval. |
| Skill/evolution → reuse/host execution | Imported resources stay data; host provenance, approved evaluation and promotion/rollback remain. Evaluation assets moved out of runtime retain their tests. |
| Deployment/Enterprise/Global/federation | Optional hosts stay opt-in. Enterprise imports are bounded/resumable with explicit incomplete states. Global/private/company/public-conversation boundaries stay distinct. |

Removal recheck: the merged branch refs are absent locally; only the canonical
MOC status adapter invokes internal status. The removed public status option
has negative regression coverage; its transition was already NAS-verified.
Runtime `dist` contains neither evaluation fixture. All retained host utilities
have source/script consumers; no new orchestrator, persistent index or cache
was introduced. Current live runtime remains the first verified release until
the final full suite and second complete pass finish.

### Complete pass 2 — independent audit, 2026-09-10

The second reviewer revisited all ten axes and seams, the removal inventory,
retained host consumers, discovery/schema fixtures and the signed import path.
No additional concrete defect, broken handoff or equivalent removal with clear
preserved value was found. All 1,001 audit inputs remained unchanged. The
previous snapshot hash was rechecked by main after the verdict. R21 therefore
has two consecutive complete change-free passes; this is not a claim of perfect
code or production performance measurement. Any implementation fix resets both.

The prepared-session discovery route remains intent search, optional exact
schema lookup, then endpoint invocation: at most three calls, excluding
required approvals and original-evidence verification. Eight representative
Korean/English queries and every default-budget exact schema are fixture-tested;
actual NAS traversal/query verification is repeated at deployment.

Final full-suite completion, deployment verification and fork push are separate
gates, not implied by these audit verdicts.

### Complexity accounting

Handwritten operational TypeScript in this unit adds/deletes 310/65 lines
(net +245); across both units it is 544/141 (net +403). Evaluation-asset moves
are reported separately rather than counted as deleted functionality. The
growth repairs accepted-handoff reconnect, exact result reuse, review receipt
freshness, bounded import recovery and full-space/contrast discovery; it is
not presented as a net reduction in operational source lines.

Removed complexity: one duplicate Pulse schema, summary-as-Claim interpretation,
the broken website entrypoint, two evaluation assets from runtime deployment,
the migrated public MOC status option and adapter branch, one merged branch,
repeated notice/schema/catalog discovery paths, and the Workshop/Work length
validator disagreement. Existing review/result records hold the new references;
no new persistent result/approval/ownership store was added. Five MCP tools and
269 endpoint IDs are retained; the public status option is removed, not an
entire endpoint. New reconnect/review inputs extend existing operations only.

### Verified final runtime

The unchanged final implementation passed 368 test files: 5,063 tests passed,
two skipped, zero failed (453.90 seconds). Guidance generation/check, build and
`git diff --check` passed. Both complete audits remained valid. The deployment
stage contained 747 files with hashes matching the generated runtime.

At 2026-09-10T14:16:40.166571Z the NAS-backed server switched to refinement-2.
Read-only verification through the new MCP process passed: five fixed tools,
269 endpoints across five catalog pages, eight Korean/English discovery queries,
exact schemas, unchanged notice suppression, canonical MOC status, rejected
retired alias, new investigation-review and Story-reconnect contracts. Existing
Roleplay and Skill hosts remained enabled. World sequence 2 and economy
sequence 1 retained their exact canonical hashes. OCR opt-in/configuration,
Vault content, journals and credentials were preserved; no live test mutations.
Both prior runtime and launcher are retained for rollback. Enterprise import
was verified with signed isolated fixtures, not by enabling Enterprise on this
normal-server NAS profile.

This unit's separate deltas before closing receipt-only documentation are:
handwritten TypeScript 310/65, tests 393/10, generated guidance 1202/1052,
generated dist 1664/1172 (added/deleted lines). Evaluation assets remain under
`tests/fixtures`; none were deleted to improve these counts. Document pruning
and the complete research receipt are separately visible in the commit diff.

Runtime verification and source/dist publication are complete; the closing
receipt records the actual verified commit rather than predicting its hash.

### Closing receipt

Implementation commit `0616a3b68aa186c0b9116eab41ca155009c3aa90` was pushed
to the user's existing `origin/main`; `git rev-parse HEAD` and `git ls-remote`
returned that same SHA after the push. The first transition commit is
`ebf45d8709c19083bb4cf51ee4e92eeb6cb82885`. This final documentation-only
receipt changes no audited implementation or deployed artifact.

R01–R21 are handled: identified defects and blocked seams are repaired,
distinct justified contracts retained, approved temporary compatibility removed,
two unchanged complete audits passed, and final tests/NAS verification/commit/
fork push completed. Only the expected `main` remote branch remains; the
unrelated detached checkout and pre-existing untracked operator/research files
were preserved. No upstream PR, package/release publication, new branch,
force-push, Vault-wide rewrite or external service activation occurred.
