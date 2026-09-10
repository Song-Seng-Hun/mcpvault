# Context-aware collaboration validation

## Deterministic protocol controls (2026-09-10)

Run `npm run build` then `node scripts/evaluate-work-collaboration.mjs`.
The script creates and removes isolated temporary Vaults; it does not contact the
live NAS, start models or mutate host profiles. Each contract faces seven negative
controls plus one valid control. Assertions fail if an expected outcome changes.

| Measurement, all eight controls | Legacy contract | Contract 2 |
| --- | ---: | ---: |
| Incorrect approvals on negative controls | 7 / 7 | 0 / 7 |
| Negative controls rejected | 0 / 7 | 7 / 7 |
| Unnecessary waits on valid control | 0 / 1 | 0 / 1 |
| Service calls, including setup operations | 40 | 67 |
| Estimated cumulative request/response tokens | 9,217 | 17,076 |
| Local review service time, cumulative milliseconds | 683.75 | 1,416.05 |

Controls: summary-only approval; missing original read; unrelated actual artifact;
wrong test snapshot; mandatory unknown criterion; missing required host execution;
an injected authorization defect that the host observer detects despite a passing
claim; and valid paired evidence. The new contract adds evidence-reading work, so
this experiment demonstrates stronger gates, **not** token or latency savings.

Tokens are request/response characters divided by four, rounded per case, not
provider billing or model usage. Calls count Work service operations, not internal
filesystem I/O. Timings vary with local load and exclude model thinking/network
latency. These are deterministic protocol rejection tests, not a study of model
understanding, independent account control, semantic defect discovery or collusion.
Dishonest but structurally consistent self-reports remain a limitation unless the
required fact is independently checked or backed by an appropriate trusted host
observation. See the [contract and host boundary](context-aware-collaboration.md).

## Regression coverage

The context-review suite exercises new-project opt-in versus explicit legacy
migration; caller-bound original ranges and pagination; raw task completion;
independent accounts versus ordinary self-verification; host exception labeling;
current project and ancestor drift; final-write source races; stale/mismatched
tests; missing host observations; mandatory verdicts; before/after source identity
and changed-line coverage; hidden/private paths; and large structured packets.
Quality regressions additionally cover all-optional host-execution policies,
8 MiB original/preliminary reads and final guards, oversized-upstream board
isolation, and fractional project/account budget boundaries.
MCP/REST integration exercises shared delivery receipts and approval, unchanged
five-tool discovery, managed-note write rejection and read-only operation policy.

The staffing suite separately exercises task templates, known/unknown execution
metadata, eligibility/tools/qualification/budget/WIP, active ownership, sequential
hats, account independence, family-first/tier-secondary diversity, configurable
preferences, deterministic bounded output and no dispatch side effects.

Separate specification and fresh code-quality reviews approved the reviewed
modules after the regression fixes. The final full run passed all 363 files:
4,966 tests passed and two skipped (`--maxWorkers=4 --testTimeout=15000`). The
default five-second first run had two integration timeouts, both subsequently
passing single-worker checks; assertions and test sources were not weakened.
See the [implementation and NAS deployment record](plans/2026-09-10-context-aware-collaboration-implementation.md)
for live checks and rollback boundaries. A protocol test is not an attestation of
model reasoning or external execution.
