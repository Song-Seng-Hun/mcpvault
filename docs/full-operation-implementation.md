# Full operation implementation plan

> For agentic workers: use subagent-driven-development; main owns integration,
> host changes and deployment. Work in main without branches, commits or pushes.

**Goal:** Resolve the three known operating gaps, not merely set enabled flags.

**Architecture:** Retain the NAS as the live Wiki. Put the XP transaction journal
on explicitly configured, probed local storage with immutable Vault/host binding
and a NAS admission marker that blocks unconfigured or competing writers. Keep
existing local-only deployments compatible. Register trusted bounded evaluators
in host code; candidates are data, never executable code. Initialize the empty
shared world with the real admin through revision-safe MCP operations.

**Tech stack:** TypeScript, Node, Vitest, Windows Task Scheduler, existing MCP.

## 1. Economy storage separation (main)

Files: `src/economy-ledger.ts`, `src/economy-host.ts`, `economy-host.ts`, `server.ts`,
new `src/economy-storage.ts` and tests; existing economy tests remain required.

- [x] Add failing tests for explicit local journal storage with a separate Vault,
  wrong-Vault binding, competing writer, restart/replay and legacy compatibility.
- [x] Separate logical `vaultPath` from physical `ledgerPath`; without ledgerPath
  preserve the existing local-Vault behavior. Never attest a NAS as local storage.
- [x] Bind canonical Vault, local storage and host identity before initial use;
  fail closed on conflicting, missing-after-initialization or changed binding.
  Protect Work mutations in unconfigured processes via the NAS economy marker.
- [x] Keep journal hashing, conservation, request idempotency, checkpoint rollback
  detection, explicit audited crash recovery and path fencing intact.
- [x] Update doctor/initialize/server to probe physical journal and checkpoint
  directories, not the separate logical NAS. No reset of existing journals.
- [x] Run `npm test -- src/economy-ledger.test.ts src/economy-host.test.ts
  src/economy-storage.test.ts --testTimeout=30000`, then related economy tests.

## 2. Real skill evaluation registration (bounded sidecar)

Files: new `src/skill-evaluation-profiles.ts` and tests. Main alone edits server
integration and private profileIds. Existing source imports remain unchanged.

- [x] Inspect admitted skills and current evaluation protocol; identify a real,
  bounded evaluator for the admitted test-driven-development skill.
- [x] Add failing tests proving a regressing candidate fails, unchanged text is
  not falsely improved, and actual target improvement can pass its stated scope.
- [x] Implement trusted profile registration without executing candidate text,
  arbitrary commands, remote models or paying for external calls. Label exactly
  what it tests; structural validation must not claim model-behavior improvement.
- [x] Preserve required approvals for changes that cannot be proven low risk.
- [x] Wire registration into the actual launcher path, configure the verified
  private host and run an actual evaluation with a revision-checked reread.

## 3. Shared-world readiness (main)

- [x] Authenticate existing admin from its verified private credential store.
- [x] Read world and initialize only if still empty, with current revision and
  stable requestId. Default title: MCPVault Commons; connected places: commons,
  workshop, archive. This provides a neutral shared starting space, not peers.
- [x] Reread the same world, verify ready=true; configure evolving operation
  through existing settings with admin as the real responsible account.
- [ ] Verify a real bounded scene/character/action flow without inventing an
  independent human identity or overwriting another participant's state.

## 4. Integration and real activation (main)

- [x] Independently review specification, then security/code quality.
- [x] Run targeted tests, build, guidance generation/check, full test suite and
  diff check. Generate dist alongside source.
- [x] Provision owner-only economic storage/config with admin as operator.
  Virtual XP has no real-currency value; do not fabricate owners or weaken
  same-owner anti-collusion checks. Record actual limits and funding separately.
- [x] Back up launcher/config, deploy a hash-matched release, safely restart only
  the identified server and use audited recovery if its crash lock remains.
- [x] Verify actual wallet/quest services, evaluator execution and ready world
  over MCP. Document real remaining eligibility restrictions, not disabled flags.

No package release, paid API, public publication, private-data export, invented
independent reviewer, automatic approval based on text matching, or unchecked
lock removal is authorized by this operational request.

## Live approval boundary (resolved by subsequent user approval)

The execution approval checker rejected the attempted empty-world initialization:
the exact assistant-selected name, places, definition and GM assignment require
user approval. No world mutation ran. The user was asked explicitly to approve
MCPVault Commons, commons/workshop/archive, and the existing admin as GM.
Do not retry that action through a different path or indirectly while it remains
unapproved. Continue unaffected implementation and verification work. The user
subsequently explicitly approved these settings and requested full activation;
the following activation receipt supersedes the pending status below.

## Pre-approval execution receipt — 2026-09-10

- Economy split-storage implementation and independent review passed. Fourteen
  storage cases include private/public/physical binding drift, partial creation,
  fresh-host legacy bypass, replay, concurrent writers and transaction guards.
  The live service has **no economy configuration or issued XP yet**. Local
  journal/checkpoint provisioning, owner bindings and treasury policy remain
  distinct from the shipped storage capability; the requested 500 XP initial
  funding and 500 XP weekly cap have not been approved or applied.
- The first full test run exposed an existing concurrent search-refresh race:
  a follower skipped the active refresh after its dirty set was consumed.
  Two deterministic create/replace regression tests failed before the fix and
  passed afterward; related search/HTTP/access tests passed (61 tests).
  Independent specification and quality review passed for the minimal wait fix.
- Final `npm test -- --testTimeout=30000`: **343 files passed, 4571 tests passed,
  2 platform skips**, 322.04 seconds. Build, guidance generation/check and
  `git diff --check` passed. Compiled output was regenerated alongside source.
- The staged release's 696 compiled files and package matched source hashes.
  Only the identified scheduled server was replaced. Prior launcher and private
  profile configuration were preserved; stale roleplay writer recovery used
  fingerprint-checked, audited recovery, retaining canonical data/checkpoint.
  New runtime PID at verification: **27656**. No world initialization or GM
  assignment occurred, and no XP ledger marker or funds were created.
- Actual MCP evaluation used `local-tdd-document-contract-v1` and existing
  candidate `751aee1418091a90e356fe5b`. Its recorded evaluation ID is
  `57656747c261725b8de354b8`, revision
  `355a1c117bed7fb11619959f68f177a32a78fa4cda871626c50f5afa315acb91`.
  The same target was reread. All six candidate document cases were true;
  baseline retained three TDD cases and lacked three added host-safety cases.
  Recorded status remains `review_required`; original skill is unchanged and
  no automatic promotion or model-behavior claim is made.
- Full shared-world readiness and funded wallet/quest operation are **not
  complete**. The user must approve the exact initial world/GM and treasury
  parameters before those durable actions can proceed. No commits, branches,
  pushes or public releases were made for this continuation.

## User-approved activation receipt — 2026-09-10

The user explicitly approved the proposed initial world, existing admin as GM,
initial virtual funding of 500 XP, and a 500 XP rolling-week disbursement cap.
These are now applied to the shared deployment, not merely enabled in code.

- `MCPVault Commons` was initialized with connected `commons`, `workshop` and
  `archive` places. Evolving mode and `worldGmAccounts: [admin]` were recorded
  through revision-checked MCP operations, with each result reread. The same
  initialized world survived the economic activation restart. Verified revision:
  `daf064fac88c05b0da43520c59df5b24e0d07737ebe915d91041b1a005d7bf4d`.
- The separate local XP journal and host checkpoint passed fixed-NTFS and
  exclusive-create/fsync/rename probes. Their new directories/configuration also
  passed canonical-path and owner/System/Administrators-only ACL checks.
- The exact scheduled server was stopped, preserving two canonical world turns
  and its checkpoint. Official fingerprint-checked writer recovery retained an
  audit. The empty economic ledger was initialized, then the stable request
  `user-approved-initial-500-xp-20260910` issued **500 virtual XP exactly once**.
  Transaction: `907b97f373be3d5dfc38b7af9612aea4c48c4c6a62361bab259786562427fcdd`.
  Offline replay verified sequence 1, issued 500, available 500, escrow 0.
- `maxSupply` is 500, so no additional issuance fits this approved policy.
  Rolling-week treasury disbursement is capped at 500. Existing pilot limits
  are rewards 10–100, posting/review fees 2/5, daily spend 107, one funded post
  per owner/day, and two open contracts. No automatic recurring mint is enabled.
- The scheduled service restarted with the private economy configuration.
  Verified PID at activation: **33224**. Actual MCP reads returned admin wallet
  500 XP, escrow 0, and a functioning empty quest market; the same wallet was
  reread and anonymous wallet access was denied. World readiness, GM assignment,
  and the existing registered skill evaluation were verified after restart.
- **Participation limitation:** only the actual admin account is presently
  admitted as an economic owner/operator/reviewer. No other account was falsely
  declared an independent owner, no peer credentials were accessed, and no
  synthetic trade or reviewer was manufactured. Paid claims need another
  host-verified owner; research/creative settlement needs a third independent
  owner as reviewer. Current funded/settled quest count remains zero.
- Skill evaluation is active, but document checks alone do not authorize skill
  promotion. The existing candidate stays `review_required` and the current
  imported skill remains unchanged. No fabricated character, scene interaction,
  attendance, ongoing model invocation or paid external execution was created
  merely to produce an activity signal.
- This activation changes host configuration and live approved records, not
  production source. The prior build/full-suite receipt remains applicable to
  that compiled release; targeted host/storage/evolution checks were rerun.
  Launcher backups and all authoritative journals/checkpoints are preserved.
