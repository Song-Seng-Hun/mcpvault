# Navigation recovery implementation plan

> Execute inline with executing-plans and test-driven-development. User approval: proceed with the three priorities from the preceding review; existing main, solo, no PR.

**Goal:** Reduce failed-task recovery and repeated graph inspection cost without turning reread claims into authorization or understanding.

**Architecture:** Keep current services and endpoints. Add a focused task diagnostic helper and generation/visibility-scoped graph scan reuse. Continuity exposes a bounded revision-linked revalidation contract; unchanged progress survives, structural/dependency drift and understanding checks remain fail-closed.

**Tech Stack:** TypeScript, Node, Vitest; committed dist; NAS-backed runtime.

## 1. Checkbox recovery

- [x] Add tests to `src/task-reanchoring.test.ts`: stale block locator gives current revision and read action but no write; duplicate identity/content, line-only requests, fences and hidden documents do not produce guessed candidates; ACL/revision races fail closed; MCP response stays bounded.
- [x] Run the new tests under the guarded single-worker runner and observe missing diagnostics fail.
- [x] Add `src/task-reanchoring.ts`; integrate in `src/filesystem.ts` and `src/createServer.ts`. A diagnostic is a reread instruction, never an automatic retry/write approval. Return no raw task text and at most one unambiguous location.
- [x] Run new tests and `src/checkbox-task-consistency.test.ts`.

## 2. Graph maintenance scan reuse

- [x] Add real-index tests in `src/graph-maintenance-cache.test.ts`: repeated calls/pages share complete scans, candidate filter is reapplied, ACL closures and graph generations invalidate, hidden targets and generated links remain excluded, oversized scans never cache a prefix.
- [x] Observe repeated traversal tests fail; add bounded occurrence/path reuse scoped to the existing VisibilityContext. Keep ensure/reconciliation and current membership checks before hits.
- [x] Compare output, fingerprints and deterministic scan counts; measure a disposable synthetic fixture, not the production Vault. Record CPU/IO limits separately.

## 3. Continuity revalidation contract

- [x] Inspect existing learning progress, pin, understanding and adapter contracts. Add tests first for selective changed-source requirements, changed structure/dependencies, small budgets and invisible sources.
- [x] Expose current revision-linked requirements and existing guarded checkpoint actions without accepting bare `revalidatedPaths` or silently restoring understanding. Preserve completed progress and independent validation states.
- [x] Verify no mutation from resume and no ready state from unchecked/incomplete evidence.

## Delivery

- [x] Targeted tests, build, complete safe suite, self-review (no independent agent), diff/staged path and content review.
- [x] Preserve rollback/canonical data; deploy to the existing NAS-backed runtime and verify bounded read-only live endpoints.
- Delivery commit: source, generated dist, tests and measured docs on main. Push only the verified user fork; the final response records the resulting commit and remote verification rather than embedding a self-referential hash here.

Community caching, paid real-model evaluation and broad file relocation are outside this batch. Existing I/O concurrency and graph relation contracts are not duplicated. No Telnet or automation enablement.

## Execution record

- Baseline reconfirmed `149f08f09`, main, only seven preexisting untracked research files at start. No other agents contacted.
- RED: all five initial task recovery cases failed as expected; unresolved and orphan repeated traversal tests failed; two real continuity revalidation cases failed. GREEN: targeted 9 files / 78 tests passed after implementation.
- Further RED/GREEN: final visibility callback drift reproduced and fixed; structured task refusal audit regression reproduced and fixed. Task adapter retains final actor/access/revision checks.
- Build and architecture-contract checker passed. Only reviewed createServer/filesystem hashes changed in the architecture manifest.
- Synthetic sequential 1k/10k measurements and limitations are in `docs/architecture/navigation-recovery.md`.
- Continuity is an actionable, read-only targeted-review contract, not automatic stale-to-ready rebasing. No bare paths can certify understanding. Existing revision-checked save and understanding validation remain the application path.
- During work an external two-line `src/skill-library.ts` change appeared, with matching dist. User explicitly approved inclusion after review. It trims/caps discovery description to 1,000 characters and omits blank use_when; original imported content/hash remain unchanged. A private baseline-versus-release assertion confirmed long, short and blank descriptions, identical original body and hash. Existing skill library tests are included in full regression.
- Full run `navigation-recovery-final1`: 489-file inventory, chunk size 10, source/build basis `a44a9f31fba9ecde5f5a02da4c0884b39d27d473a011e610ca2eff80f61eca95`. Complete: 49 accepted receipts, 6,860 assertions, 6,856 passed, zero failures and four preexisting Windows skips. Minimum free RAM 3.404 GiB. A fresh final build preserved the same source/build basis.
- Release preflight verified 978 generated files against tested dist, the exact old process/launcher/task, full regression receipts and canonical checkpoints.
- NAS-backed service switched from the retained `20260913-backlink-cache` release (PID 26336) to `20260913-navigation-recovery` (PID 21128). Old release and launcher remain available for rollback. Only verified dead writer locks were recovered; canonical originals/roleplay/economy bytes and checkpoints remained identical across restart.
- Read-only live MCP verification passed: fixed five tools; orientation and exact primary read; compilation diagnose still reports automaticApplication=false / missing host_policy; orphan page 562/1024 characters; unresolved page 830/1024; backlinks 466 characters with source revisions; assertions 339/512 partial and 1843/4000 with an intact evidence row. No operational fixture documents, account registration or content mutations were performed.
- Staged scope is exactly 30 approved files including the separately approved skill-library change. Path guard, diff checks, source/build basis and bounded credential-pattern scan passed; all seven unrelated research files remain untracked and untouched.
