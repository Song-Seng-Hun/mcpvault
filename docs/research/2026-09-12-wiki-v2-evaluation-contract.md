# Wiki v2 evidence evaluation contract — frozen 2026-09-12

Status: **12/12 targeted tests passed** in the granted guarded slot; the second run
captured the metrics below. Overall promotion is **false**. Both test processes have
exited and the slot is released to the parent. Gold and original-file hashes were
rechecked unchanged after the runs. No initial RED run is claimed.

## Ownership and preservation

Base observed: shared `main`, `b29cc2be49b409de3bc1ad4a9aafcf0d343b7f9b`.
The evaluation subtask writes only:

- `tests/fixtures/question-evidence-corpus.ts`
- `src/question-evidence-corpus.test.ts`
- `docs/research/2026-09-12-wiki-v2-evaluation-contract.md`

No delegates, production edits, original-fixture edits, branch/worktree changes,
build, full suite, staging, commit, push, deployment, or NAS access are authorized
for this subtask. Other edits appearing in the shared checkout belong to the main
owner. Tests create and remove only their own temporary fixture Vaults.

## Freeze and gold

Canonical corpus SHA-256:

```text
719e175fab2f8d5d8e8dd93704b88ec145d155615db121ae3ac706baa0a19aef
```

Hash input is UTF-8 `JSON.stringify({ notes: evaluationNotes, questions:
evaluationQuestions })`, preserving array order, property insertion order and
literal strings. It includes all 69 notes, 80 questions, gold paths, literal source
fragments, language/category labels, forbidden paths, and generated source integrity
metadata. It excludes metric implementations and reports. The expected digest is a
literal in the test; it is not calculated from mutable data as its own expectation.
The digest was obtained by a small read-only fixture import/hash operation before
any sidecar retrieval evaluation or score-driven production tuning. Concurrent
production implementation was already underway; no sidecar scores informed it.

Original fixture raw-byte SHA-256, before edits and checked again at handoff:

```text
12bda4121ceb5a6aa57c42f74630790f93449dcd8137cf03b5d6d6a97d184589
```

Original 40-question UTF-8 JSON SHA-256:

```text
c35868e415d3f8515a37f8c33127c1c44fe2181a01f7152b9520ba9fcf1c2ce8
```

The first 40 entries reuse the original objects without rewriting or relabeling.
Some original `ko` entries contain English queries; retaining those labels is part
of preservation. The source guard normalizes CRLF to LF in memory to allow
platform-specific Git checkouts; it never rewrites the original file. The literal
data digest remains unchanged. Do not rewrite the original file to satisfy tests.

The added 40 contain five questions in each category: `synonym`, `identifier`,
`negative-condition`, `contradiction`, `stale`, `relation`, `multisource`, `noanswer`.
Each category has two KO, two EN and one mixed question. There are 49 added notes,
including immutable synthetic source documents, distractors, and knowledge anchors
with literal source locators and explicit relations.

| Cohort | KO | EN | Mixed | Total |
| --- | ---: | ---: | ---: | ---: |
| Original questions | 20 | 10 | 10 | 40 |
| Added questions | 16 | 16 | 8 | 40 |
| Evaluation questions | 36 | 26 | 18 | 80 |
| Answerable denominator | 32 | 23 | 16 | 71 |
| No-answer cases | 4 | 3 | 2 | 9 |

Gold is authored from literal text, not filenames, model judgments or successful
retrieval results. Every fragment must occur in its declared note. Contradiction
cases require both claims; historical-comparison cases require both versions;
current-only cases explicitly forbid the retired schedule. Relation cases require
the linked source text, not merely the anchor. Multisource cases require both
source documents. No-answer cases have zero relevant paths and no gold fragments.

Never tune gold to metrics. A genuine corpus defect requires a separately reviewed,
explicitly versioned replacement and invalidates the prior comparison; do not
silently update this digest. Production tuning may change implementation, not this
corpus. This is a visible development benchmark, not a held-out generalization set.

## Execution protocol

Call the real `call_endpoint` transport with `endpointId: 'wiki.answer_packet'` and
`query`, `includeSemantic: false`, and `maxChars: 4000` or `12000`. Legacy omits
`retrievalMode`; the candidate supplies only `retrievalMode: 'evidence'`. No gold
paths, category hints, language hints or source locators are passed as query inputs.
The main owner confirmed query-only evidence mode implementation during preparation.
No new response-mode marker is required by this evaluation contract.

All 80 questions run in each cell, on the same 69-note content. Each cell uses a
fresh temporary Vault and server; cells and calls are serial. At 4000 characters
legacy runs first; at 12000 evidence runs first. This produces 320 packet calls.
Question order is frozen and no warm-up query is excluded. Startup/fixture creation
is outside request timing; lazy indexing on the first request remains included.

Correctness asserts transport success, parseable question packets, complete response
character budgets, disabled semantic diagnostics when present, corpus integrity,
and evaluation arithmetic. Retrieval misses, low coverage, false positives and a
failed promotion gate are measured outcomes, not reasons to fail these tests.
The final log line begins `QUESTION_EVIDENCE_EVALUATION` and contains compact budget
reports, per-language results, cost samples, frozen hashes, gate reasons and the
combined promotion boolean. `MCPVAULT_EVIDENCE_FULL_REPORT=1` additionally includes
case IDs/rankings/evidence counts/false positives; leave it unset for ordinary CI.
If transport or correctness assertions fail, no valid promotion result is claimed.

## Metric definitions

- **Recall@5:** macro average over answerable questions of distinct relevant paths
  in the first five distinct returned paths divided by all gold paths. Order is
  packet `sources` followed by `candidates`, preserving first occurrence.
- **MRR:** mean reciprocal rank within the full deduplicated returned ranking over
  answerable questions. Recall alone is capped at five. Corrected during spec
  review; historical MRR@5 measurements below must not be treated as current MRR.
- **Evidence coverage:** micro fraction of gold `(question, path, fragment)` units
  present literally within one returned passage at the exact gold source path.
  All returned source passages count, not just rank five. Duplicate source rows
  cannot double count a gold fragment. Text at the wrong path, top-level excerpts,
  candidate names, or fragments reconstructed across passages do not count.
- **Negative false positives:** separately report no-answer query/path counts and
  explicitly forbidden query/path counts. Scan all returned sources and candidates,
  including ranks beyond five; deduplicate paths within each query. Retain exact
  `(question ID, returned path)` keys for comparing runs. Non-gold paths on ordinary
  answerable questions are not automatically forbidden: navigational context and
  disclosed opposing evidence may be legitimate.
- **Empty denominators:** zero-relevant questions are excluded from recall and MRR;
  groups with no answerable questions or evidence units report `null`, not invented
  perfect scores or misleading zero-quality judgments. Questions with no relevant
  paths remain in false-positive measurements.
- **Cost:** per-call wall latency, `process.cpuUsage` user/system microseconds,
  post-call heap/RSS bytes, signed before/after heap delta, and serialized transport
  text length in JavaScript UTF-16 code units. Report latency mean/p50/p95, CPU sums,
  total/max result characters, maximum sampled heap/RSS and min/max heap deltas for
  each language and overall. These are process samples, not peak-memory tracking,
  retained-memory attribution, tokens, model latency, or CPU-isolated benchmarks.
  GC, filesystem cache and watcher work can affect measurements; negative heap
  deltas are valid. No hardware-independent performance threshold is asserted.

The original fixed lexical baseline is not reused as an 80-question baseline: both
modes are measured against the same expanded corpus and budget in the same run.

## Promotion rule (separate from test correctness)

For **each** budget, all three conditions must hold:

1. No KO, EN or mixed regression in Recall@5, MRR@5 **or evidence coverage**.
2. Overall evidence coverage improves by at least **5 percentage points**
   (`candidate - legacy >= 0.05`), not a 5% relative improvement.
3. No additional false-positive `(question, path)` key. A new error cannot be
   offset by removing a different error even when aggregate counts are equal.

Promotion requires both budget decisions to pass. A `1e-12` arithmetic tolerance
handles floating-point boundaries only. The utility tests cover the exact 5-point
boundary, a smaller relative improvement, per-language regression, changed error
identity, interleaved no-answer cases, rank truncation, duplicate paths, literal
evidence attribution, observation cardinality and cost aggregation.

## Test slot and verification

Assertions were written before their evaluation utility implementations. The
parent's initial exclusive-test-slot restriction prevented an initial RED run.
The authoring order alone
is not a completed TDD cycle: no initial RED was observed. After the parent granted
the exclusive slot, both targeted runs passed. No build or full suite was run.

The command used from `E:/dev/llm_wiki` was (future runs require a new parent slot):

```powershell
node --max-old-space-size=384 .mcpvault/deployments/20260912-preservation/run-guarded.cjs --max-old-space-size=384 node_modules/vitest/vitest.mjs run src/question-evidence-corpus.test.ts --maxWorkers=1 --execArgv=--max-old-space-size=512
```

The inspected supervisor defers below 3.8 GiB free RAM, polls every 50 ms and stops
its owned process tree below 3.5 GiB, returning code 75 for deferral/stop. The parent
and supervised Vitest Node use 384 MiB old-space caps; the single worker uses 512
MiB. The integration test has a 120-second allowance, not an observed runtime.
To schedule only utility assertions first, append
`-t 'evidence evaluation utilities'` to that same guarded command. Do not run the
unguarded `npm test`, build or full suite from this subtask. Report files, if needed,
must be retained by the main owner within its own authorized scope; this sidecar
emits metrics to stdout and does not create a report artifact itself.

## Captured results (2026-09-12, pre-parent safety fixes)

Session `7839`: 12/12 passed, exit 0, 37.01 seconds; minimum free RAM
4.531 GiB. Its console metric line was suppressed by the loaded application.
Only the sidecar reporting statement was changed to direct `process.stdout.write`.
Session `45686`: 12/12 passed, exit 0, 36.31 seconds; minimum free RAM
4.539 GiB, supervisor `stopped: false`. The second run produced the complete
`QUESTION_EVIDENCE_EVALUATION` payload. No test process remains from this subtask.
These are snapshots of the shared implementation loaded for that run, not a claim
about the parent's subsequent safety-boundary fixes. No more tests are scheduled
by this subtask while the parent owns the slot.

The 4000-character gate passes: evidence units increase from 66/91 to 71/91,
**+5.4945054945 percentage points**, with no language regression or new false-positive
key. The 12000-character gate fails: both modes retrieve 80/91 evidence units,
**0 percentage-point gain**, and KO, EN and mixed MRR regress. Overall promotion
therefore remains false despite passing correctness tests. Gold is unchanged.

| Budget | Language | Recall@5 legacy → evidence | MRR@5 legacy → evidence | Evidence coverage legacy → evidence | No-answer / forbidden FP paths (both modes) |
| ---: | --- | ---: | ---: | ---: | ---: |
| 4000 | overall | 78.17% → 83.80% | 0.6185 → 0.7500 | 72.53% → 78.02% | 5 / 9 |
| 4000 | ko | 73.96% → 78.65% | 0.6250 → 0.7552 | 74.36% → 79.49% | 3 / 3 |
| 4000 | en | 84.78% → 91.30% | 0.6087 → 0.7681 | 74.19% → 80.65% | 1 / 4 |
| 4000 | mixed | 77.08% → 83.33% | 0.6198 → 0.7135 | 66.67% → 71.43% | 1 / 2 |
| 12000 | overall | 91.55% → 91.55% | 0.6418 → 0.6195 | 87.91% → 87.91% | 7 / 10 |
| 12000 | ko | 86.46% → 86.46% | 0.6453 → 0.6401 | 89.74% → 89.74% | 5 / 3 |
| 12000 | en | 98.55% → 98.55% | 0.6413 → 0.6123 | 87.10% → 87.10% | 1 / 4 |
| 12000 | mixed | 91.67% → 91.67% | 0.6354 → 0.5885 | 85.71% → 85.71% | 1 / 3 |

No-answer false-positive query counts are KO=1, EN=1, mixed=1 in every cell.
Forbidden false-positive query counts at 4000 are KO=3, EN=4, mixed=2; at 12000
KO=3, EN=4, mixed=3. Both modes have exactly the same false-positive keys within
each budget. Existing false positives remain; “no additional” does not mean zero.
The three original no-answer IDs producing results are `q-ko-18`, `q-en-07` and
`q-mixed-07`. The added no-answer cases produce none in this run.

| Budget | Mode | Language | Mean / p95 latency ms | CPU user / system ms | Total chars | Max sampled heap / RSS MiB |
| ---: | --- | --- | ---: | ---: | ---: | ---: |
| 4000 | legacy | overall | 69.02 / 112.58 | 3250 / 2812 | 235662 | 159.45 / 239.75 |
| 4000 | legacy | ko | 71.43 / 112.58 | 1876 / 1110 | 101644 | 158.46 / 239.75 |
| 4000 | legacy | en | 65.44 / 122.01 | 749 / 999 | 76133 | 158.96 / 239.30 |
| 4000 | legacy | mixed | 69.38 / 104.00 | 625 / 703 | 57885 | 159.45 / 239.54 |
| 4000 | evidence | overall | 100.12 / 168.28 | 4812 / 3718 | 234841 | 174.74 / 255.38 |
| 4000 | evidence | ko | 101.35 / 172.87 | 2156 / 1732 | 101151 | 174.74 / 254.57 |
| 4000 | evidence | en | 94.93 / 168.28 | 1375 / 1191 | 76845 | 173.56 / 255.38 |
| 4000 | evidence | mixed | 105.16 / 162.17 | 1281 / 795 | 56845 | 173.07 / 254.63 |
| 12000 | legacy | overall | 62.93 / 106.86 | 2219 / 2922 | 313269 | 170.87 / 266.41 |
| 12000 | legacy | ko | 62.32 / 102.80 | 1126 / 1251 | 132528 | 170.87 / 266.41 |
| 12000 | legacy | en | 60.80 / 107.01 | 532 / 984 | 103709 | 170.38 / 266.41 |
| 12000 | legacy | mixed | 67.22 / 117.76 | 561 / 687 | 77032 | 169.79 / 265.40 |
| 12000 | evidence | overall | 99.76 / 171.07 | 4672 / 3844 | 335641 | 180.17 / 263.99 |
| 12000 | evidence | ko | 99.91 / 174.06 | 2111 / 1766 | 143911 | 180.17 / 263.99 |
| 12000 | evidence | en | 95.78 / 171.07 | 1435 / 1188 | 109087 | 178.57 / 262.94 |
| 12000 | evidence | mixed | 105.20 / 172.38 | 1126 / 890 | 82643 | 177.13 / 263.67 |

Costs are single-run process observations rounded for this table. The raw stdout
payload also includes per-query costs, p50, exact counts and signed heap deltas.
No raw report file was created outside the three-file write scope. Performance
numbers are advisory; the safety fixes and future runs may change them.

## Parent revalidation after safety fixes

Session `4966`: 12/12 passed, exit 0, 35.53 seconds; minimum free RAM 4.652 GiB.
Frozen corpus and original question hashes remain unchanged. The quality metrics
in the table above are unchanged: 4000 passes (+5.49 pp); 12000 fails (0 pp and
MRR regression in every language). Overall promotion remains false and legacy
remains the default. Current total response characters are 235662/235575 at 4000
and 313269/333701 at 12000 (legacy/evidence). Historical cost samples above are not
current benchmark measurements.

The separate `scripts/verify-local-evidence-inference.mjs` smoke check successfully
ran the existing cached `Xenova/multilingual-e5-small` locally with downloads
disabled, using three public synthetic strings. Relevant/unrelated similarities
were 0.7638/0.6833. This proves local inference availability only, not the full
80-query semantic quality gate, which remains unmeasured.

## Final package A measurement (supersedes historical tables above)

Session `99922`, after all source/counterpoint fixes: 12/12 tests passed in
37.81 seconds, exit 0, minimum free RAM 4.742 GiB, no supervisor interruption.
The corpus and original query hashes are unchanged. MRR below uses the complete
deduplicated result ranking, not the historical table's MRR@5.

| Budget | Language | Recall@5 legacy → evidence | MRR legacy → evidence | Evidence coverage legacy → evidence |
| ---: | --- | ---: | ---: | ---: |
| 4000 | overall | 78.17% → 85.21% | 0.6185 → 0.7523 | 72.53% → 80.22% |
| 4000 | ko | 73.96% → 80.21% | 0.6250 → 0.7604 | 74.36% → 82.05% |
| 4000 | en | 84.78% → 91.30% | 0.6087 → 0.7681 | 74.19% → 80.65% |
| 4000 | mixed | 77.08% → 86.46% | 0.6198 → 0.7135 | 66.67% → 76.19% |
| 12000 | overall | 91.55% → 91.55% | 0.6441 → 0.6218 | 87.91% → 87.91% |
| 12000 | ko | 86.46% → 86.46% | 0.6505 → 0.6453 | 89.74% → 89.74% |
| 12000 | en | 98.55% → 98.55% | 0.6413 → 0.6123 | 87.10% → 87.10% |
| 12000 | mixed | 91.67% → 91.67% | 0.6354 → 0.5885 | 85.71% → 85.71% |

At 4000, exact evidence coverage improves from 66/91 to 73/91, **+7.69 pp**;
that budget passes. At 12000, coverage remains 80/91 and every language's MRR
regresses, so that budget fails. Negative false-positive query counts are 12
and 13 at the respective budgets in both modes, with no new false-positive key.
Overall promotion remains false: **legacy stays the default**.

Final observed mean/p95 latency ms (legacy → evidence): 4000, 70.68/111.74 →
106.84/182.70; 12000, 65.68/107.18 → 110.08/200.78. Total response characters:
235662 → 236375 and 313269 → 334061. These are single-process synthetic lexical
measurements, not NAS or real semantic quality/latency claims.

## Interpretation limits

This is **synthetic lexical retrieval**, including exact identifiers, authored
aliases, literal negative conditions, explicit contradiction/temporal relations
and linked multisource passages. It tests finding evidence, not resolving truth.
The sources are fictional evaluation records, not verified external studies.
Natural-language negation cases conservatively count an unwanted draft even if the
packet labels it retired; this is retrieval exclusion, not answer endorsement.
Historical comparisons deliberately allow retired evidence when asked for it.

Real inference, semantic embeddings, model-generated answers, faithful synthesis,
contradiction resolution, temporal reasoning, multilingual semantic understanding,
real-user distribution, held-out generalization, NAS performance and independent
source truth are **untested**. A failed gate keeps the experiment unpromoted; a
passed gate does not establish any of those capabilities.
