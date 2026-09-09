# Creative workspace implementation

Approved: 2026-09-09. Work directly in `main`; do not create branches/worktrees.
Preserve unrelated files. Integrate recovered work after inspection. No push or PR.
The user's later request authorizes enabling implemented local/NAS features, but
not inventing identities, financial terms, worlds, credentials or external grants.

## Checklist

- [x] Inspect branches and detached worktree: all commits already in main.
- [x] Recover the sole untracked policy-contract test without deleting its source.
- [x] Verify baseline and recovered policy tests (initial failures recorded below).
- [x] Implement revision-safe story project, artifacts, sequence, reviews, adoption.
- [x] Implement bounded context and resumable host-driven writer sessions.
- [x] Implement manuscript/Fountain/storyboard/Canvas and branch rehearsal.
- [x] Connect eight dynamic endpoints to the fixed five-tool MCP/REST plane.
- [x] Add policy, schema, client guidance and real end-to-end fixtures.
- [x] Independent specification review, then security/code-quality review.
- [x] Targeted tests, build, guidance check, full tests, diff check and generated dist.
- [x] Audit feature readiness; activate configured features and verify live runtime.

## Ownership

Main agent owns persistence, access, adapters, integration, docs and deployment.
Media worker owns only `src/story-media.ts`, `src/story-media.test.ts`,
`src/story-branch.ts`, `src/story-branch.test.ts`; no commits/build/deployment.
Full tests and build use a coordinated single slot. Tests use temporary vaults,
never the production NAS. Existing `.agents/`, `.mcpvault/`, research notes and
the old detached worktree remain untouched except task-specific deployment work.

## Acceptance

Per-work opt-in, delegated authenticated showrunner, Markdown authoritative;
drafts/alternatives/adoption snapshots are separate. Revisions, idempotency and
source guards protect every write. Fiction, project, branch and scope boundaries
apply to retrieval, context and exports. Character knowledge is a narrative
filter, never an ACL. Review taste remains advisory. Explicit source changes
invalidate dependent summaries/reviews/shots/exports. No automatic model runner,
image generation, public publication or mutation of the shared roleplay world.

The end-to-end fixture covers two alternatives, an outline, three scenes, two
edits, adoption, format conversion, image references, branching/rehearsal and an
upstream revision that invalidates dependent output. Qualitative model comparisons
must be labelled separately from deterministic tests and require actual model runs.

## Integration evidence and remaining gates

The single complete-workflow service test passed on 2026-09-10. It creates two
alternative premises, an outline and three long scene bodies; uses a real
Workshop contribution and Work self-claim; runs two editorial revisions; selects
immutable snapshots; writes Markdown, Korean Fountain, image-linked storyboard
and file-only Canvas; rehearses a branching path; changes the opening; detects
stale summaries, shots, graph and outputs; and refreshes selected outputs.
This is deterministic service-level evidence, not a model-quality comparison.

Independent specification and security/code-quality re-review closed the reported
revision, byte-budget, reference-isolation and output-preservation issues after
targeted red/green regressions. All workers released file ownership before the
final integration gate; no worker is independently building or deploying.

Daily creative choices belong to real authenticated delegated agents inside each
work's brief and step budget. No human approval is required for each ordinary
draft/review/adoption. A missing host configuration, authority, or budget remains
an explicit waiting/setup condition, not authority to create fictitious peers.

The existing XP ledger refuses network storage at startup. Its journal currently
resides in the Vault, so the NAS deployment cannot enable that ledger merely by
adding an account or weekly budget. Do not bypass the local-filesystem guard;
separating durable ledger storage is a distinct deployment/design prerequisite.

## Host readiness boundaries

The real `admin` operator account belongs to the existing human family, with its
credential saved before registration in a verified owner-only private host store.
It is not another independent peer. Notice/guidance editing, roleplay administration,
skill approval and moderation are explicit host grants to this account; ordinary
story decisions remain work-specific delegations, not blanket peer privileges.

Roleplay is configured, but no shared world is initialized by this deployment.
Story rehearsals need no shared-world initialization. Skill evolution is enabled,
but no evaluator profiles were invented and no model execution was started.
The creative comparison against a same-model/similar-budget baseline and human
reader preference assessment remain unperformed; deterministic fixtures cannot
substitute for them. No creative-quality improvement is claimed.

## Final verification and deployment receipt — 2026-09-10 KST

- Initial default-timeout full suite: 4,503 passed, four failures, two skipped.
  Two contract failures were fixed (client instruction length and policy version
  40). The roleplay timeout and Windows temporary-directory cleanup failure both
  passed isolated reruns without changing their production behavior/assertions.
- Final `npm test -- --testTimeout=30000`: **340 files passed; 4,507 tests passed,
  two skipped**, exit 0, 326.46 seconds. The timeout flag is explicit; this is not
  a claim that the earlier default-five-second run passed.
- Final `npm run build`, `npm run guidance:check` and
  `git -c core.safecrlf=false diff --check`: exit 0. Guidance check reports 4,277
  entries, 4,847 occurrences and zero changed source files. New task files were
  additionally checked for trailing whitespace. Source and generated `dist/`
  remain together in the main working tree; nothing was committed or published.
- All 690 staged `dist` file hashes and package metadata matched the local build.
  The existing `MCPVault-SharedHTTP-8788` hidden scheduled task now launches the
  `20260910-creative-workspace` deployment. Exact old PID 27180 and its creation
  identity were checked before stopping; verified replacement PID is 27764.
- The stopped writer's leftover lock was recovered with the existing fingerprint-
  checked recovery service, after proving process death. Audit:
  `roleplay-recovery-b8bffbf8-d478-458e-aacd-0c9fd6b0742e.json` in the private
  roleplay host directory. Canonical turns and checkpoint were preserved; previous
  release, launcher and configuration backups remain available.
- Actual HTTP MCP verification authenticated `admin`, confirmed moderation,
  the fixed five tools, discovery and dispatch of all eight `story.*` endpoints,
  and the story policy. Missing-target dispatch probes wrote no story data.
  Roleplay is enabled and explicitly reports only `worldInitialization` pending;
  skill evolution is enabled and resolves the original skill. No secret was printed.
- Existing NAS notice/schema bodies and authored guidance were not bulk overwritten.
  New story policy/schema discovery is served by the deployed runtime; repository
  schema and client guidance document it. No production story project, shared-world
  initialization, evaluator profile, XP issuance, model/image call or quality study
  was created as part of the deployment probe.
