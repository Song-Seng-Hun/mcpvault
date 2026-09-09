# NAS deployment and evolving fictional world

Approved execution plan, 2026-09-09. Work in the existing checkout and user-fork
`main`; no new branch/worktree, forced push, upstream PR or package publication.

## Delivery order

- [x] Fast-forward the previously verified skill implementation into local main.
- [x] Add private host CLI configuration; verify and deploy skills to the actual NAS
  before implementing world evolution. Keep real automatic evaluators unregistered.
- [x] Add optional world evolution over the existing canonical turn journal:
  initial definition, append-only changes, current projection. No new model runner.
- [x] Implement bounded proposals, conservative automatic admission, revision-bound
  previews and authenticated approval/rejection. World changes need explicitly
  designated world GMs; character core changes need its current controller;
  mixed changes need both. No approver means pending.
- [x] Connect current context and audit history, preserve fiction/private filtering,
  old-world replay hashes, and disable settings/definition bypasses in evolving mode.
- [x] Qualify UNC canonical storage with local host checkpoints and safe cross-host
  lock/recovery identity. Fault injection only on isolated NAS fixtures.
- [ ] Focused tests, build, full suite, guidance and whitespace checks; deploy,
  verify actual MCP reads/writes, commit generated dist and push user-fork main.

## Product contract

Only designated roleplay scenes supply automatic evidence; personal conversations
and ordinary/OOC chat are not collected. Characters may gradually change beliefs,
attitudes, relationships and values. Self-reported beliefs never establish shared
facts or the other character's feelings. Prose interpretation remains agent-authored,
not a server semantic-safety claim. Only bounded typed changes with deterministically
checkable conditions auto-apply; history/laws/identity/uncertain changes wait for
approval. Keep initial definitions and replace/correct via later records rather than
rewriting history. Existing non-evolving worlds remain compatible.

`roleplay.evolution` supports propose/read/list/preview/apply/reject. Writes bind
requestId, current revision, controller generation and exact source turn revisions.
Approvals bind preview fingerprints. Context shows current settings and their
causes separately from pending/subjective beliefs; inaccessible sources stay hidden.

Production currently has no roleplay configuration. Deploy capability without
inventing a world, characters, owners or GM accounts. Preserve any configuration
found at execution time. XP/economy stays OFF. Do not restart NAS or Obsidian, sync
the local recovery Vault, or drop committed data/checkpoints to recover a runtime.

## Skill deployment checkpoint

At 22:51 KST the scheduled shared runtime restarted on its pinned verified build
with `--skill-evolution-config`, against the authoritative NAS root. The owner-only
key is persistent in host-local storage, with the same key retained in a second
private copy; no key was printed. No real evaluators or approval accounts enabled.

Verification: 24 focused tests; full suite 328 files, 4,268 passed, 2 skipped using
`npm test -- --testTimeout=30000`; build, guidance and diff checks passed.
Live `skill.resolve` reported enabled; an actual TDD experience, candidate and
unregistered-profile evaluation were committed and reread at exact revisions.
Candidate `751aee1418091a90e356fe5b` remains proposed, evaluation review_required,
and original `local-test-driven-development` revision is unchanged.
Public evidence: `Community/Knowledge/skill-evolution-deployment-20260909.md`.

The first scheduled-stop attempt conservatively stopped before restart while CIM
still reported its just-terminated process. A fresh check established no old process
or listener, then only the scheduled task was started. This was a controlled Windows
task restart, not evidence of graceful in-flight HTTP request draining.

## World implementation and NAS qualification

The new optional evolution state preserves legacy initial/replay hashes. Typed
personal perspective and exact action-effect projections auto-apply; larger
bundles use current-controller/designated-world-GM approval. Context distinguishes
initial/current/subjective/pending material. External lore drift, source correction
and retraction never silently restore superseded lore. Legacy direct core edits
stay closed after opt-in, including when temporarily fixed.

Independent review found and reproduced three gaps (hidden retraction targets,
stale initial lore fallback, and opt-in response-loss idempotency); regression
tests were first red, then green. Re-review found no remaining actionable issue.
Focused roleplay run: 11 files / 83 tests passed. Production build and guidance
consistency passed. Full suite: 331 files / 4,300 tests passed, 2 platform skips
(`npm test -- --testTimeout=30000`, 283.91 seconds). Operational cutover remains
the final gate; no claim of gameplay readiness follows from these test results.

The isolated actual NAS probe completed at approximately 23:29 KST against
`.mcpvault-validation/roleplay-evolving-rZBPko`. It refused competing and live
writers and foreign-host recovery, killed only its own child after durable intent
but before canonical rename, recovered the matching host lock, replayed, and
preserved evolved context across restart. Its sixth canonical turn was reread
through actual MCP at exact Markdown revision
`92f06955de5a32f00c07a3aa89464f0833531ea00d06ccbf777db0d17ec25a69`.
The host-local checkpoint and recovery audit were retained together with the
isolated NAS journal. These are test fixtures, not an initialized operational world.
