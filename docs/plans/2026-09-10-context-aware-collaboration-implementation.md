# Plan 2 implementation checkpoints

Approved design: [context-aware collaboration](2026-09-10-context-aware-collaboration.md).
Work on the existing main checkout; preserve unrelated files. No automatic staffing execution.

1. Review contract (main): `work-review.ts`, `work-review-context.test.ts`, and service integration tests.
   - Project `reviewPolicy.version=2` applies to newly created tasks. Explicit task-owner `migrateReviewContract` upgrades existing work; never downgrade history.
   - Task `changeContext` carries bounded reasons/scope/constraints/decisions/risks/dissent/unverified fields and exact locator IDs, roles, revisions, and line ranges. Review reads return caller/basis-bound delivery tokens only for delivered original ranges.
   - Review `checks` enumerate exact criteria with verdict, rationale, evidence IDs, test snapshot/environment/result and missing checks. Required execution uses a trusted host callback, never an API boolean.
   - RED: summary-only review, missing delivery, mismatched criterion/revision, N/A, stale upstream and direct completion must reject. GREEN: independent approval and explicit ordinary self-verification.
2. Shared gates (main): WorkService computes a context fingerprint under related revision guards. Every task mutation/completion shares it; project-policy/upstream drift invalidates approval while retaining history. Host override is separately labeled.
3. Staffing sidecar (Nash owns only `work-staffing.ts` and its test): pure advisory ranking with trusted execution profiles, essential task perspectives, independent accounts, diversity, eligibility/tool/budget/WIP constraints, preserved active owners. Main wires scoped service and adapters after reviewing the sidecar.
4. API/projections/guidance (main): extend project, packet, review, coverage; add dynamic `work.review_context` and `work.staffing` with fixed five controls unchanged. Managed note protections and read-only execution policy remain authoritative. Add adapter/bounded/security regression tests.
5. Independent specification then quality review. Fix substantive findings. Run targeted suites, build, full tests, diff check; retain adversarial evaluation evidence and acknowledge limits of evidence gates.
6. Stage a new NAS-backed release with rollback artifacts, verify the live endpoints, commit source plus generated dist, push only the existing user-fork branch. Preserve Vault/world/economy/credentials.

Test slots: worker runs only its own test with one worker. Main owns full build/test and deployment slots. Each implementation batch records its failing test before production changes.

## Verified implementation progress (2026-09-10)

- Checkpoints 1-4 are implemented. Both review-contract and staffing SPEC checks
  passed, followed by separate fresh QUALITY reviews. All reported P1/P2 findings
  were reproduced and resolved; the quality reviewers signed off current source.
- Final context/service focused run: 110 tests passed (35 review-context, 75
  existing Work service). Staffing: 74 tests passed; MCP/REST integration: 4 passed.
- `npm run build`, `npm run guidance:check`, deterministic protocol evaluation
  passed. The catalog contains 4,465 entries and no pending bindings.
- Initial full run: 4,958 passed, two skipped, two 5-second timeouts in unchanged
  Roleplay/Workshop integration tests. Both passed subsequent single-worker runs.
  The final full run `npm test -- --maxWorkers=4 --testTimeout=15000` passed:
  363 files, 4,966 tests passed, two skipped, zero failures, 375.15 seconds.
  No assertion or test source was weakened to suppress the timeouts.
- [Evaluation and limitations](../context-aware-collaboration-validation.md).

## NAS-backed deployment

The staged 753-file dist tree and package matched the verified build by hash.
The exact prior server/launcher was replaced at 2026-09-10 03:50 UTC; the new
server is PID 25944. The prior release and launcher remain as rollback artifacts.
The NAS Vault, OCR configuration, credentials, Roleplay turns and economy journals
were not reset or migrated. Post-start checks confirmed unchanged Roleplay
sequence 2 and economy sequence 1, file counts and checkpoint hashes.

Authenticated live verification confirmed the fixed five MCP tools, both new
capabilities and both service routes rejecting missing targets correctly. Existing
Roleplay and skill services remained enabled. No test project was inserted into
the live Vault: positive v2 approvals and shared MCP/REST receipt behavior were
tested in isolated fixtures. Host execution/profile/Git hooks remain unconfigured
in the stock runtime, and no existing project or task was opted in automatically.

The existing native/PDF OCR live verifier also passed after this deployment:
two native pages, all five critical scan sentences, bilingual negation, OCR
search and bounding boxes, stale-revision rejection, and byte-identical exports
in 12 bounded calls. It used only the previously approved synthetic NAS bundle.
The provider lock and temporary job directory were clear after verification.
