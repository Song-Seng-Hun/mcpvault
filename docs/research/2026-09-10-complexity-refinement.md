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
| R01 | Pulse public/internal schema drift, repeat notices | Merge duplicate contract | Existing pulse tool definition and caller revision receipts | Targeted tests passed; deployment pending |
| R02 | Answer claims incorrectly use summary bullets | Merge duplicate projection | Structured claim projection; summaries stay distinct | Targeted tests and quality review passed; rollout pending |
| R03 | Broken website command | Repair dead entrypoint | Existing `website-shibumi` app | Targeted tests passed; deployment pending |
| R04 | Economy simulation and question corpus in production build | Move evaluation assets | Test fixtures, preserving all evaluations | Targeted tests and fresh build passed; absent from staged release |
| R05 | Capability search, schema budgets, listing continuation | Reduce navigation | Existing five tools, exact-ID schemas, bounded catalog pages | Targeted tests passed; review/deployment pending |
| R06 | Unconfigured host operations advertised ready | Reduce exposure | Operation-level configured/auth/data status | Targeted tests passed; review/deployment pending |
| R07 | README repeats schemas and long feature references | Prune documentation | Short guide to existing executable schemas and topic docs | Guide/route tests passed; review pending |
| R08 | Closed Workshop strands independent research | Repair terminal path | Authorized unresolved closure; embargo remains | 25 targeted tests and SPEC passed; main quality review, rollout pending |
| R09 | Work handoff invalidates Story writer | Reconcile ownership | Explicit showrunner resume using accepted Work revision/generation | Pending |
| R10 | Workshop task output loses caveats | Preserve accepted contract | Existing Work description/context, no output database | 28 targeted tests and main review passed; rollout pending |
| R11 | Story/Quest results lack precise Work completion handoff | Reuse workflow | Existing Work packet with exact evidence; no automatic approval | Pending |
| R12 | Synthesis basis checking absent during reuse | Reuse existing check | Projection and Answer/Context packets | Targeted tests and quality review passed; rollout pending |
| R13 | Investigation review cannot distinguish reviewed results | Reconcile review evidence | Existing note/claim review records, result revision binding | Pending |
| R14 | Bridge candidates trapped in alphabetical sample | Share candidate selection | Authorized common retrieval, bounded partial-result continuation | Pending |
| R15 | Application feedback underused by review/reuse | Reuse reverse references | Existing application records, no automatic contradiction | Targeted tests and quality review passed; rollout pending |
| R16 | Packet/health/dashboard overlap | Compare before removing | Preserve different outputs; consolidate proven duplicate computation | Pending |
| R17 | Duplicate MOC status read on the mutating region endpoint | Migrate then remove | Canonical wiki.moc_region_status; legacy operation forwards only | Callers/guidance migrated; compatibility deployment then removal pending |
| R18 | Merged skill-evolution branch | Remove merged refs only | Verify ancestry, remote tip and no checked-out worktree | Removed local/remote refs; merged code remains in main |
| R19 | Enterprise support differs from general launcher | Clarify boundary | No automatic optional-host enablement | Guide and capability checks passed; rollout pending |
| R20 | Enterprise import stops after one page | Reuse host continuation | Bounded sequential pulls, explicit partial/conflict/stall result | Pending |
| R21 | Whole-system repeat audit | Re-evaluate all axes/seams | Two consecutive change-free complete passes | Pending |

Explicitly retain resource-bundle host, skill-library host and Roleplay
recovery: they have script consumers. Preserve independent meanings of
Memory/Continuity/source reads, capture/immutable evidence, deliberation/Work
review/editorial judgment, reputation/wallet/game money and Global sync/public
federation/company memory. File splitting alone is not a measured improvement.

## Verification and deployment gates

- [x] Baseline full suite in an isolated fixture environment.
- [ ] Regression first: red result recorded before behavior changes.
- [ ] Targeted tests, build, full tests, guidance consistency and diff checks.
- [ ] Specification review, followed by independent quality review.
- [ ] Preserve prior release and operator launch configuration for rollback.
- [ ] Deploy runnable batch; verify actual MCP and read-only NAS scenarios.
- [ ] Commit source and corresponding generated output together; push user fork.
- [ ] Retire migrated compatibility paths only after the transition deployment.
- [ ] Recheck every ledger item and complete two change-free audit passes.

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

This verifies the first deployment for R01–R08 (except no R09), R10, R12, R15,
R19 and R17's transition only. R17 alias removal is now eligible in the next
unit, not complete. R09, R11, R13, R14, R16, R20 and both final audits remain.

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
