# LLM Wiki learning loop: completion evidence

This audit covers the original eight-stage goal, not the later unapproved
suggestions for situation matching, procedural knowledge or question prioritization.
Markdown, Properties and Git remain authoritative. Read projections do not
certify truth, independence, comprehension, execution authority or atomic reads
across externally edited files.

## Requirement map

| Stage | Authoritative implementation | Behavioral evidence / limitations |
| --- | --- | --- |
| 1. Compare a source with existing knowledge | `src/source-comparison.ts`, existing retrieval service, `wiki.source_compare` | `source-comparison.test.ts` and MCP tests cover exact source/candidate reads, reuse guidance, scope/moderation, revision changes and bounded output. Literal observations are not semantic equivalence judgments. |
| 2. Return application experience | `src/knowledge-applications.ts`, existing capture/publication/task writers | Application model/service/MCP tests preserve the applied historical revision, environment, conditions, outcome, evidence and limits. An outcome is a report, not universal validation. |
| 3. Review concrete source changes | `src/source-change.ts`, `src/source-delta.ts`, `wiki.source_lineage` | Source-change tests cover explicit edition selection, changed passages, affected claims, exact review drafts, unchanged sources, invalid locators, hidden data and bounded scans. No inferred newest edition or automatic claim approval. |
| 4. Distinguish shared evidence ancestry | `src/source-provenance.ts`, `src/source-provenance-model.ts` | Provenance tests cover shared works/parents, reported derivations, hidden ancestors, late changes, budget warnings and retained-byte caps. Missing ancestry never establishes independence. |
| 5. Explain conditional choices | `src/knowledge-synthesis.ts`, existing knowledge/Decision Record writers | Synthesis tests preserve original notes, dissent, explanations, conditional choices, counterexamples, historical inputs, revisions and an existing synthesis. No similarity-based automatic merge. |
| 6. Turn disagreement into investigation | `src/knowledge-investigation.ts`, existing hypothesis/experiment writers and gaps | Investigation tests bind results to the saved plan revision, preserve criteria/alternatives, negative/inconclusive results and evidence, and route changed targets to review. No experiment runner or new execution authority. |
| 7. Preserve understanding across sessions | `src/continuity-understanding-model.ts`, `src/continuity-understanding.ts`, existing continuity endpoints | Model, integration, account-access and MCP tests cover bounded explanations, reported checks, questions, next steps, drift/expiry, exact locators, concurrent writers, late access revocation and same-model account isolation. Reading progress and reported comprehension remain separate. |
| 8. Evaluate actual use and deliver | `src/wiki-learning-loop-mcp.test.ts`, `scripts/evaluate-wiki-learning.mjs`, `docs/wiki-learning-evaluation.md` | The deterministic MCP story exercises all eight protocol stages. Actual isolated Codex runs separately assess canonical edits, citations, conditions, duplicates, injection resistance and cross-session interpretation. Failed runs are retained as failures, not converted into passes. |

All test paths in the table are under `src/`. Stages1–6 were individually
reviewed, built, fully tested, deployed and pushed; exact delivery records and
commit IDs are in `superpowers/plans/2026-09-07-wiki-learning-loop.md`.

## Cross-cutting acceptance

- Exactly five MCP tools remain; new behavior uses existing dynamic operations.
- No extra client installation, embedding model, daemon, persistent query cache,
  or event ledger is required by the new learning/continuity flow.
- Understanding holds short reported findings and exact references, not copied
  bodies or hidden reasoning. Authenticated account ownership supplements scope
  checks; model-only checkpoints use account-qualified paths.
- Legacy model-wide checkpoints remain intact for host ownership review. They
  are not automatically exposed or copied to another account.
- Search predicates filter before ranking and limit selection and cannot reuse
  another caller's predicate-specific cache results. Relevant tests check late
  revocation and equivalent visible-corpus behavior.
- Projection refresh requires authenticated write authority and rejects read-only
  servers; its tests verify unchanged revisions after denied calls.
- Responses use serialized character budgets, not alleged token counts. Omitted
  understanding cannot authorize resume. Tiny pulse recovery is executable and
  tested against the original target/revision, not only its advertised endpoint.
- Actual trials use host-provisioned disposable identity, not a claim that signup
  or password recovery was tested. Private marker observation precedes redaction;
  reasoning events and credentials are not persisted in reports.
- Cleanup targets only each runner-created temporary Vault/client workspace.
  Production notes, accounts, plugin configuration and unrelated files are not
  used as fixtures. Gemini/Claude actual-host evaluation remains unverified.

## Verified release gates

All eight planned stages and their delivery gates are now verified within the
scope and explicit limitations above. Source commit
`a9a80785939d5f549564b3347787c62af6698a21` was pushed to the user fork's `main`;
`git ls-remote origin refs/heads/main` returned that same SHA after the push.

1. Full-note recovery through progressive compaction is implemented and tests
   execute its later-body read. The final full validation below passes.
2. Actual-use semantic gate passed: Trial9 `3527b8ce` was independently inspected
   against transcript, Markdown and private checkpoint, including the controlled
   host edit. The full evidence and its single-scenario limitations are recorded
   in `wiki-learning-evaluation.md`; previous failures remain documented.
3. Post-change spec and quality reviews approved. Build, single-worker full suite
   and `git diff --check` passed; deployment and fork delivery remain separate.
4. Shared HTTP refreshed through the existing scheduled task at127.0.0.1:8788,
   one node PID16012. Native Codex reads confirm policy33, the full understanding
   schema and optional duplicate argument token. Anonymous resume is denied;
   the welcome revision remains unchanged. No production notes/accounts or plugin
   settings were changed. The rollback ZIP SHA256 was verified before restart.
5. Verified source/tests/docs/scripts/generated `dist/` were committed and pushed
   to `https://github.com/Song-Seng-Hun/mcpvault.git` main. Exact remote SHA matched
   the source commit above. Host state, credentials and raw evaluation reports
   were excluded. No upstream PR, release or package publication was performed.

The terminal pre-follow-up suite on 2026-09-08 passed 238 files /3496 tests with
two existing skips (458.61s, started04:29:23 KST). Later focused changes require
fresh final verification; that earlier green result is not the release gate.
The next full run (started04:52:28 KST,460.79s) completed with3498 passed,
one failure and two skips: longer pulse cadence displaced feedback/forum context.
That regression was reproduced and repaired by shortening guidance rather than
raising the user's response budget. Latest focused validation passed140 tests
across six files (05:05:09 KST,22.70s), including those original social assertions,
explicit empty-understanding state, schema recovery and HTTP authentication.

Final post-change regression run: **238 files /3499 passed /2 existing skips**,
457.50 seconds, started05:09:39 KST, `npm test -- --maxWorkers=1`. The original
execution reached exit0 and was not restarted while waiting. A subsequent
`npm run build` and `git -c core.safecrlf=false diff --check` also exited0.
Actual Trial9 has an independent semantic approval; all review workers are closed.

Native verification used `wiki.policy` with only the memory topic,
`search_capabilities` for exactly `continuity.save`, an anonymous resume rejection,
and a bounded revision-guarded welcome read. Policy fingerprint:
`494c7d96e1ebfd0a9ed8b27d136ed42c46749a63c31c5b516a8c5d1e07a0eb18`.
Welcome revision:
`84d412ca73f60858dcee1a93673de50a346f5a0ec295a80548352ca6b6a60dd6`.
Host-local rollback: `.mcpvault/backups/understanding-20260908-0320/previous-dist.zip`,
SHA256 `8956005519497DD96F0B037401451518C560508C992EB778105374E543C1040D`.
Production has not been used as a positive authenticated learning fixture; those
behaviors are covered by isolated protocol and actual-host evidence above.
