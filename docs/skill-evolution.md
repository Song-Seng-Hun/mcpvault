# Experience-driven skill evolution

This opt-in service adds `use → experience → candidate → comparison → promotion`
to the Community skill library. It is procedural memory, not a skill executor.
Only the current working agent chooses an action. There is no scheduler, new model
call, spawned agent, paid evaluation, or modification of installed client skills.

## Host admission

The default is disabled. A host application passes `CreateServerOptions.skillEvolution`
to `createServer(vaultPath, options)`; no MCP/REST request can supply this configuration:

```ts
import { createServer, type SkillEvolutionHost } from '@bitbonsai/mcpvault';

// Obtain from an explicitly provisioned host secret store, never the Vault,
// repository, request arguments, logs, or a guessed private path.
const configuration: SkillEvolutionHost = {
  enabled: true,
  attestationKey: await hostSecrets.read('mcpvault-skill-attestation'),
  approverAccounts: ['registered-review-account'],
  profiles: [], // Experience/candidates work; evaluation remains review_required.
};
const server = createServer(vaultPath, { skillEvolution: configuration });
```

`hostSecrets` is the host's own integration, not an included secret-store API.
The key must have at least 32 characters; provision strong random key material,
retain it privately across restarts, and keep a recoverable private backup. Losing
or rotating it invalidates existing attestations; do not silently regenerate a key
on startup. No production key, evaluator profile, CLI switch, environment-variable
loader, or live NAS activation is supplied by this change. Deployment is a separate
explicit host action. Keep the same key/profile configuration across cooperating
server instances for the command center.

A `SkillEvaluationProfile` fixes `id`, `revision`, `skillId`, `caseIds`,
`targetCaseIds`, `maxDurationMs`, and one trusted `evaluate` callback. The callback
receives the exact baseline/candidate text plus an abort signal, and returns
`risk: low | approval_required | unknown` and boolean baseline/candidate results
for every registered case. Automatic admission requires all designated target cases to
pass, no baseline regression, and at least one designated target to improve from
false to true. The callback must verify permitted semantic, safety, tool and
external-action boundaries; literal checks alone are suitable only for synthetic
or narrowly formalized procedures. Caller-supplied `passed` fields have no effect.

Profiles are trusted host code, never code extracted from Markdown. Fingerprints
bind profile metadata and callback source. Hosts must bump `revision` whenever
closure dependencies, test fixtures, external assumptions or evaluator artifacts
change; JavaScript function source cannot identify hidden closure state. Keep
evaluators deterministic, side-effect-free and cooperative with cancellation.
Timeouts (at most 30 seconds) do not isolate arbitrary blocking JavaScript; this is
not a sandbox for untrusted evaluators. No shell or model evaluator is included.

## Agent workflow and dynamic endpoints

The fixed five MCP tools are unchanged. Use `call_endpoint`; REST dispatches the
same service. All writes require a live access token, current write capability,
host opt-in and a writable server. Approval additionally requires the authenticated
account in `approverAccounts`, never an author-supplied account/model label.

| Endpoint | Operations and contract |
| --- | --- |
| `skill.resolve` | Read usable current procedure, source/current revisions and drift status. |
| `skill.experience` | Create with `expectedRevision: missing`, stable `requestId`, `applied: true`, `shareable: true`, outcome, context/summary, exact `usedVersion` and evidence. |
| `skill.candidate` | `read`, bounded `list`, `create`, revision-safe author/reviewer `update` or `reject`. Creation binds base/current revisions and experience locators. |
| `skill.evaluate` | `read` or `run` a registered comparative evaluator; binds candidate revision and every basis/evidence guard. |
| `skill.promote` | `preview` then `apply` the returned fingerprint and exact current revision, with a stable request ID. `auto` needs current passing evaluation; `approved` needs host reviewer and reason. |
| `skill.rollback` | Host reviewer `preview`/`apply` to the previous intact version, with revision, fingerprint, reason and request ID. |

Discover one endpoint's current schema for exact arguments. `maxChars` is
1,024–12,000; lists use revision-bound cursors and limits 1–20. Reread the returned
target after each mutation. A retry must retain the identical logical payload
and request ID. Historical retry receipts return the original revision, not a
claim that it is still current or even still present; reread before using it.

Record one representative skill actually applied to the current task, not filler
activity or mere reads. Outcomes include success, failure and unknown. Personal
paths/logs/conversations stay private; this release has no automatic private-to-
Community conversion. Shared text requires explicit sharing confirmation and
rejects private paths, recognizable secrets, unresolved/private links and embeds.
These checks cannot identify every secret in ordinary prose: review what is shared.

## Markdown contract

`Community/Skills/<id>/SKILL.md`, imported references and license remain untouched.
All added records are under `Community/Skills/<id>/_evolution/`:

- `experiences/`, `candidates/`, `evaluations/`: exact applied versions, proposed
  procedures and comparative outcomes; failures/rejections retain their reasons.
- `versions/`: promoted procedure text, source/license, previous version, candidate,
  evaluation and evaluation-basis guards.
- `transitions/`, `snapshots/`: promotion/rollback decisions and exact old pointer
  bytes preserved when replacing an existing current record.
- `current.md`: the single last-written pointer and its applicable dependencies.
- `receipts/<target-hash>/`: ordered, signed write intents containing exact target
  snapshots; `commits/` confirms landed writes. These are audit data, not procedures.

All records carry ordinary `skill_record_kind` / `skill_evolution` Properties.
`skill_attestation` authenticates host decisions, but never authorizes execution.
No score, index, reaction or success count is permission or truth. Each target's
intent inventory is capped at 256; exhaustion or a missing interior sequence fails
closed for host review. There is no automatic journal compaction or deletion.
Record/source reads are bounded to 256 KiB; target snapshots are capped at 128 KiB.
Imported source inventory is bounded to 33 Markdown notes; evidence lists to eight
exact visible locators per input and combined writes to 100 guards.

Normal discovery excludes candidates, receipts and other audit records, and resolves
matched imported/evolved skills to the usable current version. The packet role is
still `procedural_reference`, not factual evidence or installed-tool permission.
An explicit `skillId` can let pulse offer one relevant pending candidate after
existing work priorities; no supplied skill or a busy host triggers no library scan.

## Conflicts, interruption and trust boundary

Mutations hold a cooperative per-skill cross-process exclusive lock at
`.mcpvault/skill-locks/<id>.lock`. Another runtime retries when busy. A crashed
process can leave a lock: a host must first verify that no owner is alive, preserve
the journal, then remove only that confirmed stale lock. There is no lease stealing.
Local tests cover lock contention; behavior of exclusive creation and coherent
reads must also be verified on the deployment's actual SMB/NAS filesystem.

The host-only SDK exports `inspectSkillLock(vaultPath, skillId)` and
`recoverSkillLock({ vaultPath, skillId, expectedFingerprint, confirmOwnerStopped: true })`.
Inspect first, independently verify that all relevant runtime owners have stopped,
and pass the exact returned fingerprint. Recovery rejects changed markers, unsafe
paths and symlink/junction parents, and removes only that lock. It has no MCP/REST
endpoint and does not infer stopped ownership from age or PID. A `.recovery` gate
serializes host recovery attempts; if the recovery process itself is killed, host
forensic cleanup of that exact gate is required after confirming recovery stopped.

Write intents precede target writes; commit receipts follow them. A retry can finish
a landed write's receipt or rerun current policy and resume an unlanded prepared
write. It never resurrects a deleted committed target. Partial versions/evaluations
remain audit data until the current pointer is written last. Current source,
candidate, evidence and profile drift invalidate automatic use/promotion; ordinary
Obsidian edits are preserved and reported as `needs_review`, falling back to source.
An edited/unattested current pointer requires host-approved recovery and its old
bytes are snapshotted. Rollback verifies the previous version's full evidence and
profile, not merely that its file still exists.

An older signed current/candidate file alone is not fresh: its revision must match
the latest committed receipt. Generic MCP/REST writes, moves and deletes cannot
mutate evolution records or move their ancestors; dedicated service writes grant
only one exact destination. Direct Obsidian/host edits remain possible and lose
automatic validation. Markdown and Git remain authoritative; there is no
hidden database pointer. Consequently a privileged actor who coherently restores
the entire Vault and journal can restore old state. Detecting that requires an
external monotonic authority, which this release does not introduce. Keep host
ACLs/backups and review whole-Vault restores. Signatures are not a substitute.

Generic note writers, the importer and Obsidian do not participate in the skill
transaction lock. Revision guards and post-write verification detect ordinary
drift, but portable filesystem writes cannot promise atomic multi-file CAS against
non-cooperating external writers. Avoid concurrent manual edits/imports while
promoting; preserve backups and review any reported conflict. A prepared request
whose evidence/profile changed is not silently resumed with different guards.
An authorized approved promotion can supersede an interrupted current-pointer
intent, preserving the old pointer snapshot and all journal entries. No live Vault data
is migrated, deleted or rewritten just by enabling this service.

## Verification

```powershell
npm test -- src/skill-evaluation.test.ts src/skill-evolution.test.ts src/skill-evolution-lock.test.ts src/skill-evolution-recovery.test.ts src/skill-evolution-mcp.test.ts src/skill-evolution-pulse.test.ts --maxWorkers=1
npm run build
npm test -- --maxWorkers=1
git diff --check
```

Synthetic profiles verify comparison and the complete workflow, not the semantic
adequacy of arbitrary real-world skills. Admit real profiles individually after
host review. Never publish packages/upstream changes as part of this workflow.

See the [dated verification record](skill-evolution-validation.md) for results
and deployment checks intentionally left to the host.
