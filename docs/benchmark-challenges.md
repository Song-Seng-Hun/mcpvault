# Opt-in benchmark challenges and bounded issuance

This subsystem is separate from Quest escrow, reputation, roleplay and model
execution. It never starts a model, enrolls an account, executes submitted code,
opens a URL, runs a command, compiles a submitted regular expression, creates a
host configuration or approves monetary values. Tests use isolated temporary
directories and artificial policy values only.

## Runtime integration contract

Exports are fixed:

```ts
import { loadBenchmarkHostConfig } from './src/benchmark-host.js';
import { BenchmarkService, type BenchmarkOptions } from './src/benchmark-service.js';
import { getBenchmarkTools, benchmarkOperation, BENCHMARK_TOOL_ENDPOINTS,
  BENCHMARK_MUTATING_TOOLS, BENCHMARK_MUTATING_ENDPOINTS } from './src/benchmark-tools.js';
import { acquireBenchmarkWriter } from './src/benchmark-runtime.js';

const host = await loadBenchmarkHostConfig(configPath, expectedVault);
// Enabled writable runtime only. Register close after in-flight work drains.
const writer = await acquireBenchmarkWriter(host);
const service = new BenchmarkService(fs, {
  ...host,
  assertActor: async principal => revalidateAuthenticatedPrincipal(principal),
  accountAvailable: async accountId => currentTaskAccountExistsAndIsNotBanned(accountId),
  // Optional existing canonical ledger, never a second economy:
  ledger,
  access: scopeAccessPolicy,
  pathFilter,
});
await service.execute(benchmarkOperation(toolOrEndpoint)!, paramsWithoutToken, principal);
await service.pulse(principal); // {endpointId, arguments, reason} | undefined
// During orderly shutdown, after draining work: await writer.close();
```

`BenchmarkOptions` requires `enabled`, `definitions`, `accountProfiles()`,
`assertActor(principal)`, `accountAvailable(accountId)`, `assertHumanOperator(actor)`, `answerReader(definitionId)`
and `integrity.{sign,verify}`. Optional fields are `ledger`, `access`, `pathFilter`
and `now`. The loader returns all required fields except `assertActor` and
`accountAvailable`, plus its
validated host configuration. Pass a fresh authentication callback; never take
verified profiles, operator status, signing functions or answer readers from
endpoint input. `accountAvailable` must consult the actual current authentication,
task-capability and moderation backend, independently of the host's approval list.
It is checked for actors, submitters and reviewers at durable boundaries and again
inside the trusted ledger proof validator.

The loader fixes the configuration, key and answers in private memory and rechecks
their exact bytes, canonical paths and owner-private permissions on reads and
durable boundaries. Any drift latches the running binding closed until verified
restart; changing and restoring a file does not silently re-enable that instance.
Do not replace its callbacks with permissive snapshots. Custom host adapters must
provide equivalent immutable-answer and current-approval guarantees.

If a ledger is configured, construct its `benchmarkAuthority` with
`assertHumanOperator: host.assertHumanOperator` and
`validateAward: (proof, state) => service.validateAwardProof(proof, state)`.
A closure can capture a verifier variable, initially undefined (refuse awards),
then receive the real `createServer` service through a host-owned
`bindAuthority(service)` callback after actual authentication/moderation callbacks
are connected. This reuses the same backend accounts and ledger. Do not construct
a second permissive verifier merely to break the constructor dependency.
Historical replay does not call this adapter. New transactions and response-loss
retries do. The callback receives replayed state and must **not** call
`ledger.snapshot()` or `transact()` from inside the ledger writer queue.

The server wires the shared registry, HTTP/MCP adapters, authentication extraction,
read-only rejection set, capability classification, optional
`--benchmark-config` flag and pulse engagement callback as follows:

| Internal tool | Endpoint | execute operation | Mutating |
| --- | --- | --- | --- |
| `list_benchmarks` | `benchmark.list` | `list` | no |
| `read_benchmark` | `benchmark.read` | `read` | no |
| `submit_benchmark` | `benchmark.submit` | `submit` | yes |
| `review_benchmark` | `benchmark.review` | `review` | yes |
| `finalize_benchmark` | `benchmark.finalize` | `finalize` | yes |

Do not put `open`, `reserve_program`, `award_program`, `close_program`, `cancel_program`, `issue`,
host config paths, expected answers or integrity keys into public tool schemas.
Strip `accessToken` after authentication before calling `execute`.

## Host configuration and opening

`loadBenchmarkHostConfig(configPath, expectedVault)` is read-only. Both arguments
are absolute paths. Its JSON input has exactly these keys:

- `version: 1`, explicit `enabled: boolean`, `vaultPath`, `hostPath`;
- `operators`: canonical human operator IDs, disjoint from agent profile aliases;
- `definitions`: zero to 100 `BenchmarkDefinition` values;
- `profiles`: alias-to-profile map; each profile has `accountId`, `ownerId`,
  `modelFamily`, `approved`, `modelVerified`;
- `integrityKeyFile`: basename of a preexisting 32–128-byte hex key file;
- optional `answerFile`: basename of a preexisting JSON object mapping immutable
  definition IDs to answer strings.

Config, signing key and answer files must remain in the verified local private
host directory outside both Vault and source checkout. The loader uses the
existing guarded private-file reader; symlink/file-size violations fail closed.
It suppresses private path, parser and answer errors. It never hashes the expected
answer into a public definition, endpoint, note or ledger event. Expected answers
exist only in host-private files and transient grading memory.

The private record HMAC also authenticates the frozen answers for the objective
versions actually present in that record, without storing the answers or any
unkeyed answer digest. A changed answer therefore cannot regrade an existing sealed
version after restart. Adding a different version's answer preserves verification
of old records. Existing records need their original key and answers; key rotation
or answer correction requires an explicit recovery/new-version workflow.

Each alias must equal its canonical profile in every field. Different approved
accounts with the same `ownerId` may each win once. Changing sessions, aliases or
problem versions does not reset the canonical account/lineage entitlement.
Model-family identity comes only from verified host profiles, never a principal's
self-declared model label.

Definition fields are `id`, stable `lineage`, immutable `version`, `title`,
`problem`, exact `sources[{path,revision}]`, ordered
`rubric[{id,description,minimum}]`, canonical millisecond UTC `deadline`,
`allowedTools`, `mode`, `answerKnown`, optional `grader`, `reward`, `maxWinners`,
`cap`, `qualityThreshold`, `participants`, `reviewers`, `allowSameOwnerReview`.
Host definitions must refer to canonical approved accounts. Unknown answers
require `mode: 'peer'`. Do not silently change a definition in place; open a new
ID/version with the same lineage. The host is responsible for assigning stable
lineages to the same problem and preserving its canonical account bindings.

Opening is an explicit host action:

```ts
await service.open(challengeId, humanOperatorId, {
  expectedRevision: 'missing', // or current lineage record revision for a new version
  requestId: hostRequestId,
});
```

The host CLI adapter can use this single dispatch method:

```ts
await service.executeHost('inspect', { challengeId }, humanOperatorId);
await service.executeHost('open', { challengeId, expectedRevision, requestId }, humanOperatorId);
await service.executeHost('finalize', { challengeId, expectedRevision, requestId }, humanOperatorId);
await service.executeHost('close', { challengeId, expectedRevision, requestId }, humanOperatorId);
await service.executeHost('cancel', {
  challengeId, expectedRevision, requestId, reason,
}, humanOperatorId);
await service.executeHost('project', {
  challengeId, expectedRevision, requestId,
  expectedProjectionRevision: 'missing', // or current projection-note revision
}, humanOperatorId);
```

`inspect` reports the current lineage revision or `missing` and never opens a
challenge. `finalize` uses the same deterministic adjudication and canonical ledger
as the agent endpoint, with human host authority in place of an agent session.
`close` releases only the unused reserved headroom after deadline; it does not
revoke already paid rewards. `cancel` is an explicit human-only CAS transition
with a nonempty reason, allowed before deadline and even after source drift or
participant revocation. It records cancellation before releasing unused reserves,
blocks future submission/review/finalization and preserves every already issued
reward. Retrying an interrupted cancellation completes the release. `project`
writes a revision-guarded managed snapshot
at `<Community root>/Benchmarks/<id>.md`, verifies the written revision and refuses
to overwrite an unmanaged note. None of these host verbs belongs in MCP/REST
agent schemas. The offline CLI uses these shared host methods and the existing
authentication/moderation backend, not a second server or economy implementation.

### Offline host CLI

After building, run `node scripts/benchmark-host.mjs --help`. The script resolves
compiled imports relative to itself, so an absolute script path works from another
working directory. Every invocation requires explicit absolute Vault/config paths,
an approved human operator and challenge ID. Inspect first:

```text
node scripts/benchmark-host.mjs inspect /absolute/vault /absolute/private/benchmarks.json human-operator challenge-v1
```

`inspect` accepts no mutation flags, starts no server, acquires no writer/ledger,
and does not register an account or create a challenge. Enterprise-marked Vaults
are refused by this legacy CLI until a matching enterprise adapter is supplied.

Stop the configured writable runtime before any mutation; do not remove its lock
to force a second writer. The following values are placeholders, not live approval:

```text
node scripts/benchmark-host.mjs open /absolute/vault /absolute/private/benchmarks.json human-operator challenge-v1 --expected-revision missing --request-id operator-selected-id
```

For existing records replace `missing` with the exact revision returned by inspect.
`finalize`, `close`, `cancel` and `project` require the same revision/request guards.
`cancel` additionally requires `--reason TEXT`; `project` additionally requires
`--expected-projection-revision missing` or its current exact note revision.
Positive-reward operations also require `--economy-config /absolute/private/economy.json`
with already approved matching program terms. The CLI never invents those terms,
creates keys/answers, raises caps or steals abandoned locks. Restart the normal
runtime after successful maintenance; verify the same challenge through its endpoint.

Do not automatically call it on config load, server startup, login or pulse.
Zero-reward tournaments use `reward: 0, cap: 0` and need no wallet. Positive
rewards require an already approved enabled economy policy with an exact
`benchmarkPrograms` entry from `BenchmarkService.issuanceProgram(definition)`.
Its fixed participant IDs, definition/rubric fingerprints, reward, maximum winners,
cap and close time must match. Creating such an entry is a separate human monetary
approval; the subsystem supplies no live numbers and never raises `maxSupply`.

## Sealing, review and freshness

One final literal answer is accepted per canonical account/problem lineage.
`practice: true` only acknowledges the bounded literal input: it is not stored,
not graded against a hidden answer and not eligible for rewards. This prevents a
practice endpoint from acting as an answer oracle. It does not consume the final
submission slot. Submission endpoints never return a grade before finalization.

Private records live at `_whispers/benchmarks/<lineage>.md`, under the existing
managed private service-path boundary. They contain the original definition,
sealed entries, locked reviews and request receipts, authenticated with a
host-private HMAC key. Generic notes/search must retain the existing `_whispers`
exclusion. A valid record seal authenticates content; it is not a replacement for
the ledger's independent anti-rollback checkpoint. Host filesystem access and
other conversation channels are outside the blind-review boundary.

Objective graders support exact literal strings, structured JSON with sorted
object keys (duplicate/unsafe keys rejected, depth 20, nodes 2048) and finite
numeric values with an explicit absolute tolerance. Inputs are at most 12,000
characters. Invalid expected answers/provider failures are indeterminate and hold
finalization. Invalid submitted JSON/numbers fail. Neither expected nor submitted
text is executable. `allowedTools` is immutable declared task policy; this service
does not control an agent's tools outside its own operations.

Numeric and structured-JSON number tokens retain exact decimal precision:
an integer coefficient and decimal exponent are compared without converting
answer/submission values to binary floating point. `9007199254740992` and
`9007199254740993` are distinct, as are `1e-1000` and zero. Equivalent decimal
spellings compare equally (`1.00`, `1e0`, `1`), including numbers nested in JSON;
JSON strings remain a different type from numbers. Absolute tolerance is
inclusive and interpreted from the immutable configured number's canonical
decimal spelling, so `2` versus `2.1` at tolerance `0.1` passes exactly.

Each numeric token is limited to 100 characters with an explicit exponent in
`[-1000, 1000]`; these limits are checked before arbitrary-precision arithmetic.
The existing whole-answer, JSON depth and node budgets still apply. Invalid or
out-of-budget host answers return `indeterminate` and the service holds grading
without a final decision or award; invalid/out-of-budget submissions fail instead.
The current service represents a host grading error as `state: "held"`, not a
literal `grading_error` field. No host answers, source records or existing ledger
awards are rewritten by this precision fix.
Only space, tab, CR and LF are accepted as JSON whitespace outside strings;
NBSP, BOM and other Unicode whitespace remain valid string content, not separators.

Read/finalize responses include bounded `route` provenance: comparator or peer
mode, its reason, skipped work, `modelCalls: 0` and
`peerCorrectnessClaim: false`. Objective reflex grading explicitly skips peer
review; it makes no peer-correctness claim. Tests compare the literal comparator's
pass/fail outcomes with service results. No model invocation adapter exists here.

Peer entry bodies become available only to approved verified reviewers after the
submission deadline. Metadata omits authors and accounts. Other reviewers' scores
remain hidden until the reader locks their own review of the same entry; final
decisions can expose sanitized review/results projections. Submitted prose may
itself identify its author, so authors must avoid identifying prose when blindness
matters. Self review is rejected. Same-owner review requires explicit
`allowSameOwnerReview`; it is model diversity with weaker independence.

Every ordered criterion needs a 0–100 score, reason, exact configured source
references, uncertainty and supported/contradicted/uncertain evidence disposition.
There must be two distinct host-verified reviewer model families for every entry,
and at least two comparable entries from the same immutable definition before a
peer tournament can finalize. Revoked profiles, changed owner/family bindings,
source revisions, hidden/deleted sources or indeterminate grades hold payment.

Pass/fail disagreement or conflicting/uncertain criterion evidence holds the
tournament. A further reviewer from an additional family can independently
resolve it by citing **all** earlier locked review IDs in `resolutionOf`; its
complete criterion scores then determine that entry. Without conflicts, scores
are averaged. Quality requires every criterion minimum and the mean threshold.
Qualifying entries rank by total score, then scores in the declared criterion
order, then final submission sequence. Only the declared top N win.

Reads have a 4,000-character default and 12,000-character maximum, with bounded
pages and revision-bound cursors. `field=status` remains minimal after source
drift; rich data is refused and list/pulse omit unavailable challenges. Scores,
counts and award eligibility are projections recomputed/checked against current
sources and approved profiles, not independent authority.

Entry lists show bounded previews with `answerTruncated` and `totalChars`; use
`field: entry, entryId, offset` for literal answer chunks. Your own `submission`
uses the same chunk envelope. Review lists show criterion scores/dispositions;
`field: review, reviewId, offset` returns chunks of the exact review JSON only
after the same blind-review disclosure gate. Follow `nextOffset` and pin
`expectedRevision` when assembling chunks. `textLimit` is at most 4,000 characters;
the service also accounts for JSON escaping so the complete response fits
`maxChars`. Large definitions explicitly list omitted/detail fields; fetch
`problem`, `rubric` and `sources` separately. Nothing accepted at the maximum
answer length requires an unbounded read to review it.

Obsidian projection notes contain the public problem, mode, deadline and snapshot
counts, without author IDs, submitted answers, review bodies or expected answers.
Their frontmatter always says `snapshot_requires_revalidation`; they never claim
that a static file is dynamically current. The note directs the reader to
`benchmark.read`, whose freshness is evaluated at read time. Host projection
refresh is explicit, not a background task. Pulse suggests an optional unsubmitted
challenge before deadline or eligible pending blind peer review afterward, without
enrollment, writes or model calls.

## Canonical ledger and recovery

`reserve_program` is human-operator-only and reserves
`maxSupply - issued - all outstanding reservations` atomically in the existing
ledger. A reservation is not issued XP. Ordinary `issue` respects reservations.
`award_program` consumes the fixed program amount, credits its canonical approved
account and increases issuance only after the configured trusted service adapter
revalidates the sealed adjudication. JSON flags/claims cannot supply reducer
authority. Global dedup uses `(problem lineage, persistent account)` independently
of program/version/request ID. Existing `available + escrow = issued` still holds.

Finalization saves a signed immutable decision before attempting any payment.
An interruption can therefore be retried: each winner has a stable ledger request
ID, and previously paid winners replay without issuing again. Other ordinary
request IDs are payload-bound. A reserved program left by an interrupted host
opening can be reused only if its complete approved terms still match. No locks,
journals, caps or checkpoints are reset automatically.

After its declared close time a human operator can release unused headroom using
`ledger.transact({ op:'close_program', actor, requestId, programId,
expectedRevision: economyRevision(snapshot.programs[programId]) })`.
Closing is explicit and stops unpaid awards; already paid awards remain conserved.
The parent host should settle the intended winners before closing. No endpoint
grants generic issuance/opening/release authority to agents.

`cancel_program` is additionally human-operator-only, requires an exact program
revision and reason, and can release unused headroom before deadline. It never
burns or claws back issued rewards. Prefer the service's `executeHost('cancel')`
path to persist the tournament's cancellation before releasing its reservation.

## Multi-process writer lifecycle

`acquireBenchmarkWriter(config: LoadedBenchmarkHostConfig)` returns
`Promise<{ close(): Promise<void>; assertHeld(): Promise<void> }>`. For an enabled
writable host, it is exported from both `benchmark-host.ts` (CLI convenience) and
`benchmark-runtime.ts` (implementation); both exports are the same function. For an enabled
writable runtime, acquire it once **before** exposing services; release it only
after in-flight operations drain. It uses exclusive local host-file creation,
fsync, canonical Vault binding, a random ownership nonce and file identity checks.
Disabled configs create no lock. Failed starts must close only their own acquired
lease. An ownership mismatch closes the handle but leaves the marker untouched.

Host CLI `inspect` remains read-only and acquires neither this lock nor a ledger
writer. Host CLI `open`, `finalize`, `close`, `cancel`, and `project` acquire the
same lease and therefore refuse to run until the writable runtime has stopped.
The CLI and server both enforce writer ownership at service boundaries. They must use
the same verified local host directory for a canonical Vault. This is local
multi-process exclusion, not a claim of distributed locking across independent
machines or unrelated host directories.

The helper never steals a stale lock, even when its recorded PID is dead. After
an abnormal shutdown, stop all candidate runtimes and CLI writers, verify process
death and the exact host/Vault ownership, inspect signed records and any ledger
prepared intent/checkpoint, restore a consistent state if necessary, and remove
only the positively identified orphan marker through explicit human maintenance.
Never reset the journal or checkpoint to make a lock error disappear. No automatic
lock-removal or recovery command is exposed by this subsystem.

Old policies and old journal events omit the optional program/award fields and
retain their previous replay behavior. The writer's existing external checkpoint
anchors historical authority; current callbacks validate new operations and
retries, not historical source states. Quest accounting and verifier contracts
remain independent.

## Verification record

TDD RED runs preceded the ledger, grader/model, host loader, service and tool-map
implementations. On 2026-09-11 the worker ran:

```text
npm test -- src/benchmark-model.test.ts src/benchmark-service.test.ts
  src/benchmark-host.test.ts src/benchmark-ledger.test.ts src/benchmark-tools.test.ts
  src/benchmark-runtime.test.ts
  src/economy-model.test.ts src/economy-ledger.test.ts
8 files passed; 67 tests passed (including the separate-process writer tests).
```

The subsequent host-entrypoint compatibility export was checked RED → GREEN;
`benchmark-host.test.ts` and `benchmark-runtime.test.ts` passed together (8 tests).

An owned-entrypoint TypeScript check with `--ignoreConfig --noEmit` and the
repository's strict flags passed; it included these new sources/tests and
`economy-model.ts`/`economy-ledger.ts`. `git diff --check` passed for the modified
tracked economy files. No global build was used to perform this check. The parent
separately reported four passing benchmark MCP adapter tests; that report is
parent-owned evidence, not a test execution claimed by this worker.

Global build/full-suite/dist generation, registry
wiring, host config edits, commit, push, deployment and live actions belong to the
parent and were not run by this worker.

Known operational boundaries: live monetary values are not approved or enabled;
host answer/key/config files are not created; no background projection refresh,
external-agent tool-use attestation or anonymity against self-identifying prose is
claimed. CLI exposure and shared adapters are implemented; final build, full-suite,
runtime and deployment evidence is recorded in the execution plan rather than
inferred from worker-local test results.

### Objective precision follow-up (2026-09-11)

The precision regression RED run reproduced five wrong-account awards through
the real service and canonical test ledger, not just comparator assertions:
the incorrect early entrant received 10 test units instead of zero. The fix
preserves the original test cases and adds exact-decimal, structured-JSON,
tolerance-boundary, numeric-budget, invalid-host/invalid-submission and paid
retry fixtures. A separate RED run reproduced six invalid JSON whitespace cases
before restricting separators to space/tab/CR/LF.

Final targeted verification after both fixes:

```text
npm test -- src/benchmark-model.test.ts src/benchmark-service.test.ts
  src/benchmark-ledger.test.ts src/benchmark-host.test.ts --maxWorkers=1
4 files passed; 92 tests passed.
```

Strict scoped TypeScript `--ignoreConfig --noEmit` passed for
`benchmark-model.ts`, `benchmark-model.test.ts`, and `benchmark-service.test.ts`.
Invalid host answers retain the existing `indeterminate` to `held` service
contract; no new error field, production service change or ledger schema change
was introduced. This follow-up changed only those three files and this document;
no global build/full suite, dist output, TRPG changes or live monetary operations
were performed.
