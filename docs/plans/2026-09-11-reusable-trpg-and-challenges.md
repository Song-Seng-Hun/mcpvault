# Reusable TRPG, verified explanations, portable installation and challenges

Status: implemented; independent reviews, full tests and NAS deployment verified.
Native macOS/Linux execution and live model/reward activation are not claimed.

## Authority and compatibility

The user approved implementation on the existing main branch, NAS-backed deployment,
live verification, generated dist, commit and push to the user's fork. No new branch,
worktree, package, release, upstream PR or force push. Preserve unrelated files,
Vault/world/economy records and credentials. New subsystems are opt-in.

Markdown, exact revisions, reviews and canonical ledgers remain authoritative.
Five fixed MCP tools remain; expose dynamic endpoints through shared services.
Every mutation needs access/revision/idempotency checks and read-only rejection.
No model wakeups, execution runner, new web app or cross-host data auto-copy.

## Approved deliverables

- [x] Portable setup: separate connect-existing and install-server; explicit Vault,
  program and private-state paths; preview/fingerprint/apply, safe config merge and
  backup; stdio/local HTTP/remote HTTPS; read-only doctor; secret-free manifest and
  remapping; Windows/macOS/Linux core; unsupported PDF isolation fails closed;
  fix installer fixed target and roleplay-host CWD dependency. Manual safe migration.
- [x] Verified explanations: operator-selected onboarding/usage collection,
  immutable originals and pinned imports; Korean beginner sidecar by default;
  paragraph locators, mechanical fidelity checks, independently verified cross-model
  semantic review; stale-on-source-change; restricted drafts; scope no broader than
  source. Gemini preference is advisory. Pull recommendations after explicit/current
  work and before optional challenge; voluntary claim, WIP and no automatic calls.
  If Gemini or a reviewer is unavailable, keep the job waiting: no automatic model
  substitution. Explicit voluntary manual claims remain possible; no quality ranking.
- [x] TRPG: opt-in versioned bounded declarative rules; sheets, resources, equipment,
  status durations, prerequisite DAG, exclusions, atomic growth, named loadouts,
  revision-bound respec preview; scene initiative/turn/round/end and atomic effects;
  host rolls stored once in durable intent/turn, deterministic retry/replay, no preview
  RNG or caller rolls. Small own strength/agility/intellect HP/focus d20 preset with
  attack/guard/heal; no automatic permanent death or wallet reward. Reuse graph and
  configuration validation for learning paths/procedural bundles, not tool authority.
- [x] Reflex paths: exact read, current approved explanation, registered game action,
  trusted fixed answer comparator, valid continuity resume; keep every current access,
  revision, policy, resource, deduplication and issuance guard; bounded route provenance,
  stale fallback and equivalence/call-count tests.
- [x] Challenges: human-approved set/problem/version/criteria/deadline/allowed tools/
  reward/max winners/issuance cap; objective OR peer reward per problem; unknown answers
  peer-only; sealed final submission once per approved persistent account; same-owner
  approved agents may each win once per problem lineage (not session/version resets).
  No submitted-code/command/URL execution. Exact/typed/numeric bounded comparators;
  private host answer storage, no answer hash leakage; errors are indeterminate.
  Blind criterion reviews from >=2 approved verified model families; no self review;
  same-owner reviews labeled weaker independence; conflicting pass/fail/evidence held
  pending additional review. Peer >=2 comparable entries, quality threshold + top N;
  tie: declared criterion order then final submission order. No review quorum => no XP.
- [x] Bounded mint: host-approved program reserves unissued global supply headroom;
  mint only on qualified awards in the existing ledger, stable lineage/account award
  identity; exact retry/concurrency/restart safety; return unused reservations on close;
  no automatic supply cap increase or invented live monetary policy. Preserve Quest
  owner separation. Reputation, wallet XP and roleplay growth stay distinct.
- [x] Obsidian/MCP views: sheets/skill-tree and challenge list, participation, reviews,
  awards through ordinary Markdown/Bases/managed Canvas with bounded access-safe views.

## Work ownership

- Controller: explanation service, reflex wiring, challenge/economy integration,
  global adapters/registry/runtime, acceptance review, builds/full suite/deployment/Git.
- Portable worker: scripts/mcpvault-setup.mjs, scripts/obsidian-host-plugins.mjs,
  scripts/roleplay-host.mjs, src/portable-setup.test.ts, docs/portable-installation.md.
- TRPG worker: src/roleplay-*.ts and adjacent tests, src/capability-graph.ts/test,
  docs/roleplay-trpg.md. Global adapters remain controller-owned.
- No worker commits, builds dist, runs full suite, edits host config or touches live data.

## Verification and rollout gates

Test-first changes; targeted tests, build, full test suite and diff check. Independent
spec review then quality/security review. Required cases include access/revocation,
path traversal, bounded output, concurrency, policy/source drift, crash recovery and
malicious document data. Track real OS execution separately from portable code tests.

Order: setup foundation; explanations/reflex; TRPG; no-reward challenges; bounded
issuance. Deploy code with new live features off unless their explicit configuration
and approvals exist. Monetary values must be approved by a human, not invented.
Rollback code/config separately; never erase committed turns or minted XP using Git.

## Execution record

- Baseline: main tracking origin/main; tracked tree clean; pre-existing untracked
  .agents, .mcpvault, six 2026-09-09 research files and scripts/__pycache__ preserved.
- MCP orientation and returned welcome action read; no registration or Vault mutation.
- Implementation is present for all domains; whole-repository and deployed
  acceptance gates passed. No live model profiles or benchmark monetary
  values were invented. Existing world rules remain unchanged until explicit adopt.
- Portable setup passed independent spec and quality review. Its synthetic Windows
  fixture evidence does not certify native macOS/Linux execution or real host ACL
  provisioning; see the validation boundaries in `docs/portable-installation.md`.
- TRPG worker: 15 files / 122 tests passed; independent spec re-review: 4 files /
  36 tests passed. Original-receipt room revocation and the branching preset were
  corrected. Managed projection rollback preserves competing edits; the three
  derived files are not a crash-atomic transaction. Quality review passed after a
  portable reserved-filename correction: controller 4 files / 27 tests passed;
  independent verification covered 81 collision-free artifacts and actual con/aux
  export/project, unchanged canonical IDs and rejection of arbitrary aliases.
- Controller integration batch: 6 files / 70 tests passed. Existing Roleplay HTTP
  integration passed separately at its unchanged default timeout on 2026-09-11;
  earlier contention-related failures and diagnostic relaxed runs are not used as
  substitutes for that result.
- Explanations: 4 files / 43 tests passed. RED-to-GREEN regressions cover profile
  drift across restart and explicit recovery, late source/ACL changes throughout
  reads/lists, serialized block and record limits, and unverified claim refusal.
  Final quality re-review passed with 25 additional independent checks. Build
  passed after these changes.
- Benchmark numeric precision review found a paid-path false-positive risk.
  Exact bounded decimal/typed JSON comparisons now have regression coverage,
  including real canonical ledger fixtures. Independent spec and quality passed:
  6 files / 98 tests and 330 extra precision/parser-boundary assertions.
- Read-only predeployment inspection confirmed runtime PID18028 still owns the
  NAS-backed world/economy writers. World sequence 2 and economy sequence 1, their
  checkpoint hashes and record counts match the previous verified deployment.
  Rollback-aware deployment and read-only live acceptance scripts were prepared
  before any restart. No live challenge, draft, rule adoption or mint was performed.
- Guidance regenerated and final build/check/whitespace gates passed. Catalog:
  4832 entries / 5462 occurrences, zero source drift; the one pending binding is
  canonical durable TRPG route prose, not a runtime-translated receipt. Code/test
  freeze: 703 files, SHA-256
  `76b50478002440351e2edd5ebcc7f88dd0f94946d982f4235e53493b3912288d`.
- Staged 798 generated files plus package metadata; every hash matched the working
  build during read-only deployment preflight. Original staged runtime and launcher
  backup are retained. The exact staged runtime was deployed after acceptance.
- First four-worker whole-suite attempt was interrupted after failures in three
  existing integration files. Those same files then passed 99 tests with one worker
  at unchanged default timeouts. The final `npm test -- --maxWorkers=2` run passed:
  397 files, 5491 tests, 3 skips (5494 total), 844.18 seconds, started 07:26:45 KST
  on 2026-09-11. No assertions/timeouts were weakened or tests excluded. The 703-file
  source fingerprint matched exactly after the run and before deployment.
- NAS deployment completed at 2026-09-10T22:43:10.2893140Z: PID10524, localhost8788,
  `.mcpvault/deployments/20260911-reusable-expansion/release/dist/server.js`.
  Only the launcher's code entry changed. Task, NAS path, private configurations,
  approved economy policy and optional OCR settings were preserved. Exact prior
  process handles and creation times were checked before stopping PID18028/21080;
  audited recovery preserved every canonical turn/journal/checkpoint.
- Read-only live acceptance passed: five MCP tools, 282 dynamic endpoints over six
  catalog pages, both reusable configuration kinds, unchanged legacy TRPG world,
  exact-note reflex, disabled unconfigured explanation/benchmark hosts, and prior
  Wiki/Workshop/Story/Skill/Pulse contracts. World sequence 2/hash
  `4c8749e3b5ca8b0c598f8009a28a41da68810253a83e6073ce529b5a44f02ab7`
  and economy sequence 1/hash
  `0e4102c705fd5d87234e84cc4fc810b404c59ad02d4af9f05cdbaebcc501f2ac`
  remained unchanged. No live registration or gameplay/financial test mutations.
- Git handoff is restricted to the existing main branch and user fork. The 150
  staged files exclude host data, credentials, caches and unrelated research;
  staged whitespace and credential-pattern checks passed. This record accompanies
  the implementation commit; the final task response reports the verified remote
  commit SHA after the ordinary push. No package, release, upstream PR or force push.
