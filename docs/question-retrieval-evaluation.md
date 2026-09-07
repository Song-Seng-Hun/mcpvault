# Question retrieval evaluation

This synthetic local regression corpus tests the existing lexical engine and
the question adapter. It is not a BEIR benchmark run or evidence of general
multilingual RAG quality. No model, vector service, or production Vault is used
by automated corpus tests.

## Corpus and measurement contract

`src/question-corpus.ts` fixes 20 notes and 40 queries: 20 Korean-labeled,
10 English, and 10 mixed. Labels describe the test group; an alias probe in the
Korean group intentionally uses its English alias. Cases include ambiguity,
negation/exclusions, conditions, late/multiple passages, missing knowledge,
retired knowledge, counterexamples, and community noise. Separate integration
tests cover immutable claim evidence, stale locators, hidden sources, body-read
races, tiny budgets, and ordinary task leads.

Four cases have no relevant answer and are excluded from the relevance metric
denominator (36 answerable cases). They may still retrieve unrelated words:
finding context is deliberately not a verdict that it answers the question.

- Recall@5 is mean per-question `relevant retrieved / total relevant`, not
  merely whether any relevant result was found.
- MRR is the mean reciprocal position of the first relevant result.
- Evidence coverage checks each expected fragment only in passages belonging
  to its expected document, never in an unrelated result or generated summary.
- Counts are serialized JSON **characters**, not tokens. I/O counts are full
  `readNote` calls, excluding index/metadata reads and streaming revision
  verification; they are not total disk operations or bytes.

The first sidecar report incorrectly labeled HitRate@5 (0.9444444444) as recall.
The evaluator was corrected and the unchanged lexical search remeasured:
**Recall@5 = 0.9212962963, MRR = 0.8402777778**. Query texts, note contents and
gold document paths were not changed to improve these scores. Several evidence
annotations were corrected from translations or Properties keys to actual body
substrings; the fixture now verifies that every expected fragment exists.

## Automated results

Measured on Windows, 2026-09-07, one Vitest worker, semantic search disabled.
Before: 40 lexical calls, limit 5, maxChars 1800, total 37,425 JSON characters.
Question packets are measured at maxChars 12000; a second 1800-character packet
run demonstrates the cost of fitting source context into a tiny budget.
The 12000 packet and legacy compact retrieval must not regress on Recall@5/MRR.
These budgets are deliberately different: a source packet does more than a
search result list, so it is not a same-cost latency comparison.

Verified final targeted run: packet Recall@5 **0.9351851852**, MRR
**0.8620370370**. The legacy MCP compact response also matches the original
scoped adapter for all 40 queries, not just the core search ranking.

| Measurement, 40 packet calls | maxChars 12000 | maxChars 1800 diagnostic |
| --- | ---: | ---: |
| Recall@5 | 0.9351851852 | 0.7361111111 |
| MRR | 0.8620370370 | 0.8055555556 |
| Exact expected evidence coverage | 84.09% | 61.36% |
| Total JSON characters | 116,735 | 51,955 |
| Full body reads | 129 | 129 |
| Mean latency, milliseconds | 24.81 | 22.04 |

The 1800-character diagnostic is not the 4000-character default. It shows that
aggressively shrinking whole packets discards useful context; smaller output
does not reduce the number of selected source reads in this implementation.
Read caps and response caps are different controls. Each document is read once
per request, at most 8 documents. Timings are machine-dependent measurements,
not speedup promises. These are service/protocol calls, not a measured count of
all model orientation and discovery calls. The real-host trial is separate.

```powershell
$env:MCPVAULT_EVAL_REPORT = '1'
npm test -- src/question-corpus.test.ts --maxWorkers=1
Remove-Item Env:MCPVAULT_EVAL_REPORT
```

The existing engine already accepts any matching ordinary term. Query mode
does not label a partial lexical hit as an OR expansion. Only an actual miss
gets one explicit ordinary-word OR retry; quoted phrases, filters, and
exclusions are never relaxed. Query-only ranking prefers broader question
coverage in existing previews and exact visible identities; compact search
retains its existing order. No new embedding or generated contextualization is
introduced.

## Real Codex acceptance (not a protocol simulation)

Two ephemeral Codex CLI runs used Luna Medium and a disposable read-only HTTP
fixture, with only this prompt: “연결된 위키에서 자동 재시도를 언제 허용하는지
알아보고 답해줘.” No account or production document was created.

The first run stopped after onboarding and did not answer the question. The
orientation guidance was clarified: for an already requested knowledge
question, onboarding is preparation and `wiki.answer_packet query` is the next
route. A second fresh Codex run returned the actual restrictions: idempotent
read requests only; no automatic payment-creation retry; experiment limited to
service A version 2; retry count and interval unspecified. It preserved
conditions and uncertainty, but did not print explicit path/revision citations
in the final prose. Thus source interpretation was observed, not guaranteed
citation compliance across models. Disposable fixture notes/configuration were
removed afterward. No claim is made about Gemini or Claude acceptance here.

## Deployment verification

Final build passed; full Vitest run completed with **212 files, 3193 passed,
2 pre-existing skips** (single worker, 2026-09-07). `git diff --check` passed.
The existing shared HTTP task was restarted with the new build, retaining its
port, host binding, and plugin configuration. In the already connected Codex
MCP session, an anchored question returned the exact welcome-note paragraph,
and its revision-pinned line read reproduced that paragraph. An unanchored
`Git commit` query returned `partial` context in 2822 JSON characters with
explicit missing-immutable-evidence guidance. No production note/account was
written; the welcome revision remained unchanged. The previous build is kept
in a host-local rollback backup, outside source Git.

## Inspiration, not implementation equivalence

[Contextual Retrieval](https://www.anthropic.com/engineering/contextual-retrieval)
motivates retaining context lost by isolated chunks; this implementation uses
exact Markdown units and headings, not its generated-context embedding
pipeline. [BEIR](https://github.com/beir-cellar/beir) motivates fixed relevance
judgments and explicit retrieval metrics; this small local corpus is not a
substitute for BEIR or a broad multilingual evaluation.
