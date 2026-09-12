# Graph retrieval, topic packets and local Graphify execution

Status: P1 delivered at implementation commit2e6bc86b. P2 code/reviews/build/full regression and NAS deployment with user-confirmed empty-state acceptance are complete; fork delivery is recorded by Git. P3 follows next. Successful operational-MOC packets remain unverified because no MOC has been authored yet.

## Authority and coordination

- User approved the three-stage plan in the GraphRAG/Graphify task, including
  per-stage verification, NAS-backed deployment, rollback, source/dist commit and
  push to the user fork on existing `main`. No new branch/worktree or publication.
- B owner explicitly released source freeze and the single heavy-test slot after
  deployment and fork push at `bb67b5f9508d693483b354975c7408e35d26ceb2`.
- Baseline verified locally; preserve the seven unrelated untracked research files.
- Main owns production/adapters, stage execution and delivery. One disjoint
  evaluation worker owns graph evaluation fixtures/tests; no parallel test runs.
- Current user-approved host guard: start at2.3GiB free RAM and stop the owned
  verifier tree below2GiB. The earlier3.8/3.5GiB entries below are historical.
  No user apps or unrelated live services are terminated to obtain headroom.

## Approved stages and acceptance

### 1. Opt-in two-hop evidence retrieval

- `wiki.answer_packet` adds optional `graphDepth: 1 | 2`; omission retains the
  legacy contract. Depth 2 requires query and evidence retrieval.
- Top five existing candidates seed metadata-first discovery. Bound the request
  to 40 metadata documents, eight body documents and 80 relation occurrences.
- Follow authored evidence, supports, contradicts, depends_on and derived_from
  through at most two edges; source links count as edges. Reuse reverse
  contradiction discovery. Preserve direction and distinct same-pair relations.
- Never guess ambiguous references. Prioritize counterpoints, prerequisites and
  originals before additional context. Return reasons and at most three pinned
  evidence paths, with locators. Degree/distance is not a confidence measure.
- Strict phrase/filter/exclusion queries suppress graph expansion. Budgets yield
  partial output and exact follow-up actions. Revalidate every observed path used
  in the response; access/revision drift discards prior context.
- Preserve frozen 80 questions/gold; compare legacy/evidence/depth2 at 4000 and
  12000 characters. Add separate graph edge-case corpus. Promotion requires
  unchanged language Recall@5/MRR, >=5 percentage-point evidence gain and no new
  negative false positive. Unsuccessful experiments remain opt-in.

### 2. Read-only topic packets

- `wiki.topic_packet`: required mocPath, optional query, limit default/max8,
  maxChars default7000/max16000, at most64 current metadata documents.
- Use accessible explicit MOC members in existing order and reuse synthesis
  candidate/reference/basis services. Return claims, applicability, counterpoints,
  open questions, existing synthesis status and revision-pinned source reads.
- Mark sampling boundaries; never claim a sampled packet covers the entire topic.
  Current agent reads originals and authors summaries through existing
  knowledgeSynthesis/mcp.publish_knowledge; packet reads never publish.
- Compare pinned inputs with current membership/access/revisions; retain existing
  synthesis path, revision and original input pins. Changes require review.
- Evaluate MOC vs Leiden offline on identical corpus/model/budget; production
  groups remain authored MOCs, with no GraphRAG server or paid API.

### 3. Host-only local Graphify

- Isolated Python venv, official stable graphifyy release and artifact SHA256
  pinned before installation. No global Python, Git hooks or resident workers.
- Host build/query/impact over allowlisted repository code/design/tests; AST code
  edges and explicit document links only, agent handles semantic interpretation.
- Exclude NAS, secrets/host settings, .agents, .mcpvault, .git, node_modules, dist.
- Versioned Git-excluded derived JSON retains repo ID, file hashes, locators,
  extraction/tool versions and raw multiple edges separately from clustering.
- Revalidate files on query; stale/deleted files cannot be current evidence.
  Related tests are candidates, never represented as passed without execution.
- Validate real TypeScript and fixed fixture import/call/reference/test relations,
  multiple edges, changes/deletions, bounds and path containment. Verify actual
  installed build/query/impact. Measure first/repeat/update cost and RAM; NAS
  transfer needs separate measurement, not an inference from response size.

## Per-stage completion checklist

For EACH stage: RED/GREEN tests; targeted tests; strict build; full regression
under the single memory-protected slot; independent SPEC then QUALITY review;
whitespace/path/content/secret screening; NAS deployment and real read-only
endpoint checks; rollback preservation; source+dist commit; check:staged;
user-fork push and remote verification. No stage is complete from a plan or a
partial test run alone. Keep five stable MCP tools and Markdown authority.

## Execution record

- P2 current status: service26 and MCP/REST1 targeted assertions and strict build
  passed. Independent SPEC and QUALITY findings were reproduced and closed.
  Same-budget offline MOC/Leiden fixture comparison and bounded current-agent
  summaries are documented, with no model API calls or general quality claim.
  Full455-file regression completed on frozen basis
  `c0bbac864b0dbda4f983824dea0ac50e3b26b121f0f9bb588be35e864f4027cb`;
  with6377 passed assertions,4 existing allowed skips,0 failures/missing files.
  Completed per-file receipts are retained and interrupted runs excluded.
  Worker heap256MiB is an explicit lower-memory option; coordinator192MiB
  (384MiB for llm-wiki, topic-packet-mcp and scope-security) and single-worker
  execution. document-structure retains its original512MiB worker after a
  confirmed256MiB V8 OOM; its complete rerun passed22 assertions.
  A bounded30-second admission grace period handles transient headroom loss
  without lowering thresholds. NAS release/rollback preparation and read-only
  preflight and activation succeeded. Canonical data was preserved and the old
  runtime retained. The user confirmed the operational Wiki intentionally has
  no authored MOC yet: live acceptance verifies the empty-state/read-only/schema/
  invalid-input/budget contract without creating notes. Successful MOC packets
  remain locally fixture-verified, not live-positive-verified. See topic-packets.md
  for measurement scope and limits. Fork commit/push follows this acceptance.

- Baseline and ownership verified after B handoff. No implementation from B is
  claimed as this task's work. Stage 1 tests are being authored first.
- P1 RED reproduced missing depth traversal, direction/path annotations, option
  validation and metadata-first body allocation. GREEN: 20 service assertions
  and four public read-only MCP adapter assertions. Follow-up RED showed reverse
  discovery read 65 metadata documents and allowed ordinary backlinks to exhaust
  the counterpoint window. Shared request metadata and internal relation filtering
  corrected both. Intermediate revision/access withdrawal tests discard all text.
- Strict TypeScript build passed after correcting optional revision narrowing
  and the navigation-fingerprint call signature. Independent SPEC is in progress;
  QUALITY, exhaustive regression and delivery are not complete.
- Initial graph-only fixture evaluation passed its two integrity/routing tests:
  16 fixed questions/117 notes, SHA256
  `ea596abf5e567bdbd39e12811921cddbfdd225fd58a123c3e17d6b7a7cb01f7f`.
  Evidence coverage vs current evidence rose 7.69 percentage points at4000 and
  15.38 at12000; no new negative false positives. Alias questions did not resolve
  within the fresh40-document identity window. Do not claim broad improvement.
- Initial frozen80 evaluation passed all13 assertions, original hashes unchanged.
  At4000 legacy/evidence/graph evidence coverage was66/91,73/91,72/91; graph
  Recall@5=.80986 and MRR=.75939. At12000 coverage was80/91,80/91,84/91; graph
  Recall@5=.91549 and MRR=.62254. Graph vs current evidence missed the gate at
  both budgets (language regressions at4000; +4.40pp below5pp at12000). Graph
  also missed legacy MRR preservation at12000. **No default promotion.**
- Evaluation uses local temporary storage, in-memory MCP, lexical-only synthetic
  queries, first and repeated corpus sweeps. No cold-OS-cache, server-exclusive
  peak RAM, model quality, money savings or NAS-transfer measurements are claimed.
  These are preliminary measurements before independent-review fixes/final basis.
- Independent SPEC raised seven functional gaps. All seven reproduced RED, then
  the service suite passed27/27 after direction/ambiguity/locator, metadata partial
  preservation, shared occurrence-budget and safety-classification fixes. Fresh
  build and existing evidence21, question12, context-target14, graph8 and endpoint4
  assertions passed. SPEC re-review is pending; no QUALITY approval yet.
- The first post-review graph reevaluation hit the unchanged memory stop at
  3.488 GiB. Its local `review1-graph.log` is an interrupted diagnostic only;
  there is no success/measurement receipt for that run. Check owned process exit
  and recover headroom before another heavy command. Do not lower safety limits.
- Follow-up SPEC fixes reproduced RED for non-progressing omitted-body actions,
  plain-reference anchors, fabricated author line1 and full-author context scans.
  Service29 and strict build passed; independent SPEC closed all7 findings on
  static review. Separate QUALITY review is in progress. Compact reverse reads
  have no neighbouring-context projection; index construction remains a separate
  corpus preparation cost, not bounded by the80 candidate inspection limit.
- Post-fix graph evaluation `review2-graph` passed2 assertions with unchanged
  graph corpus hash and quality metrics (+7.69pp/+15.38pp evidence coverage vs
  current evidence at4000/12000, no new negative false positives). Free RAM stayed
  above4.006GiB. Local sampled graph RSS was267–273MB across repeat cells; these
  are process boundary samples, not peak or NAS/network measurements.
- QUALITY raised malformed-pin validation loss and silent truncation of claim
  declarations. Three malformed-pin variants and claim82 reproduced RED; all33
  graph service assertions then passed. A deterministic timer-boundary test also
  reproduced nested graph reconciliation rejecting unchanged content. Async-local
  stable generations now avoid nested scheduled refresh while preserving actual
  invalidation, ACL and revision failures; a concurrent-reader test verifies
  isolation. Independent QUALITY closed its findings after static re-review.
- One targeted/build launch mistakenly overlapped before terminal completion was
  checked. Both exited successfully but were excluded from final verification.
  A subsequent explicitly sequential run passed17 context-target,4 endpoint and8
  graph assertions, then strict build; no memory stop occurred in that rerun.
- Full regression uses `graph-p1-final1`, exact source/test/dist basis
  `872d862d849c9adb05e079c03547ace5c19cf2c8e38f16e31e79fb945ce57531`.
  Do not combine older evaluations or interrupted reports with this basis.
  The lightweight graph-only first/repeat diagnostic had no differences, but
  earlier full-cell score variation is not thereby proven resolved. Promotion
  stays disabled; final comparison and NAS delivery evidence remain pending.
- Current accepted full-run coverage:49/453 files,558 passed assertions and1
  existing allowed skip;0 failures,404 files outstanding. Shards1–3 and4 completed
  isolated files have receipts. Shard4 stopped at3.496GiB; file-isolated
  `agent-pulse.test.ts` stopped at3.491GiB. Both owned process trees exited
  successfully and neither interrupted run contributes coverage. A read-only
  process check found no surviving verifier. Do not rerun already receipted files
  or claim an incomplete collector as a full-suite pass.
- Host-local P1 release/rollback launcher prepared; read-only preflight passed
  for882 dist files, the existing B runtime and writer/canonical state. No service
  activation or canonical mutation occurred. Independent bounded deployment
  review found no blockers; automatic rollback is not implemented, and the live
  smoke script alone does not prove a real two-hop chain. Live endpoint/SMB
  measurement, deployment, commit and push remain gated on full verification.
- Work is safely paused for additional RAM headroom. The approved ten-minute
  heartbeat resumes from the same receipt basis, not from B's already completed
  freeze. Do not lower memory thresholds, terminate user applications or change
  frozen source to manufacture a pass. The peer's newly approved later work starts
  only after all three stages are delivered and ownership is explicitly handed off.

- User confirmed no further RAM can be freed. The4.8GiB retry suggestion is no
  longer an entry condition. Local-only verification now calls Vitest directly,
  avoiding npm/cmd intermediaries;192MiB coordinator and512MiB worker ceilings,
  guard start3.8/stop3.5, full assertions and source basis remain explicit.
  A tested ordering heuristic runs smaller non-server files first, filtering none.
  Fourteen additional files passed:63/453 files,592 passed assertions,1 allowed
  skip,0failures,390 missing. Agent-pulse and enterprise-feature-selection still
  memory-stopped; these do not count. The last run deferred before the next file
  at3.796GiB. No app termination or guard reduction was performed. More RAM is
  not a user action request; heavy-test memory use remains an engineering limit.

- The resumed direct-Vitest run completed415/453 required files with5280 passed
  assertions,3 allowed skips and0 failures before reference-preparation was
  memory-stopped (start4.440GiB, observed minimum3.383GiB, owned-tree kill0).
  After the verifier exited, fresh CIM showed no verifier and only3.315GiB free.
  This is a host free-memory admission conflict, not evidence that the single
  test consumed the full difference or that Windows/Node ran out of memory.
 38 files remain. No source/test/dist changed; the same basis remains valid.
  Request an explicit local guard-policy adjustment instead of more user RAM or
  unchanged retries. All tests and deployment data-preservation gates stay required.

- User explicitly approved a2GiB reserve for local verification/deployment.
  Admission now requires2.3GiB and the test monitor stops its owned tree below2GiB.
  One worker and all assertions/coverage requirements remain unchanged. The
  final monolithic wiki suite reproduced a coordinator heap OOM at192MiB; its
  coordinator alone was raised to384MiB, worker512MiB unchanged. This is distinct
  from host free-memory guard stops. Local launcher contracts were RED/GREEN.
- Final collector on basis872d862d849c9adb05e079c03547ace5c19cf2c8e38f16e31e79fb945ce57531:
  complete=true,453/453 files,6350 passed assertions,4 explicitly allowed skips,
  zero failed assertions/reports,zero absent files,zero unreceipted reports.
  The last93 wiki assertions passed; minimum observed free RAM2.069GiB.
  Existing source/dist build and independent reviews remain bound to this same
  unchanged basis. No interrupted report contributes to completion.
- Final graph-specific evaluation receipt final5-graph passed with the original
  fixture hash and identical first/repeat quality metrics: evidence gain over
  existing evidence+7.69pp at4000,+15.38pp at12000; no new negative false positives.
  This fixture alone does not authorize a search default promotion.
- Final frozen80 receipt final5-evidence passed13 assertions with original hash
  719e175fab2f8d5d8e8dd93704b88ec145d155615db121ae3ac706baa0a19aef.
  First/repeat quality metrics matched on this final run. At4000 graph/evidence
  Recall@5=.79577/.85211,MRR=.75939/.75235,evidence coverage70/91 versus73/91.
  At12000 graph/evidence Recall@5=.91549/.91549,MRR=.62254/.62183,
  evidence coverage84/91 versus80/91(+4.40pp, below the5pp gate).
  Negative-query false-positive counts were11/12 at4000 and13/13 at12000;
  these counts are not a claim of zero false positives. Keep graphDepth2 opt-in.
  This is local synthetic lexical evaluation, not model answer quality or NAS
  network measurement. Both final evaluation processes exited0 without guard stops.
- P1 NAS-backed runtime activation succeeded after a fresh full-regression gate,
  exact882-file release/hash comparison, scheduled-task/process identity checks
  and canonical preservation checks. Old runtime and rollback launcher remain.
  Only confirmed-dead writer locks were recovered; originals/world/economy were
  not reset, initialized or rewritten. The new runtime owns both writer locks.
- Actual read-only MCP verification passed:fixed5tools, graphDepth schema and
  invalid-input rejection, pinned source revision, depth1/depth2 at4000/12000,
  first/repeat bounded responses and strict-query suppression. No inference calls
  or knowledge mutations occurred. This public welcome-note smoke proves the
  endpoint contract, not a representative live two-hop evidence chain; graph
  chains/ACL/races have local synthetic regression coverage.
- Live smoke first depth1 took1736ms; subsequent depth1/depth2 observations were
  approximately167–234ms. SMB share-wide raw counter deltas were0 during the
  6.22s observed window. OS caching/provider behavior and other clients affect
  this counter, so this is NOT proof of zero logical I/O or transfer savings.
  A post-smoke canonical reread confirmed original/backup/restore equality and
  unchanged roleplay/economy bytes and checkpoints. Existing NAS direct-write
  protection remains explicitly deferred, outside this release's claim.
