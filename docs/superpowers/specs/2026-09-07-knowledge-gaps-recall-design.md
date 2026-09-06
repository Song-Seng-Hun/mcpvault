# Current personal recall in knowledge gaps

The user delegated design approval and fork-main delivery. This increment repairs
the existing knowledge-gap projection, not the whole organization goal.

## Evidence and choice

`knowledgeGaps` only loads private state when a shared prompt exists, uses the
shared interval, and reads private bodies with failures disguised as absence.
Its candidate list is already top-limit bounded; do not claim it retains the
whole Vault. The existing inventory path can use cached metadata.

Options: patch only precedence (leaves stale and failed reads), replace the
endpoint with recallQueue (loses epistemic work), or retain the endpoint and use
fresh bounded metadata plus guarded, bounded projections. Choose the third.

## Contract

- Preserve question/hypothesis/experiment/assumption/dispute/negative reasons,
  review snoozes, deterministic ranking, and no mutations.
- Read source and own private state through access predicates, fresh strict
  metadata, and the existing 8 MiB per-note bound. Never read another agent's
  state. Hidden private state contributes no question/history/cadence.
- Private question and interval override shared defaults. Agent history remains
  personal; another reader's shared last-recalled date cannot suppress it.
- Validate intervals using the same normalizer as recording. Invalid values
  yield repair reasons, never a fabricated due time.
- Return source revision and observed private state revision (or `missing`).
  Recheck selected inputs, including missing state, before returning; storage
  errors are explicit unavailable results rather than fictitious unseen history.
- Preserve exact questions up to 1000 characters. Longer questions are omitted
  with a revision-checked property-only `notes.read` action. No answer bodies.
- Keep bounded candidate retention and do not add workers, models or caches.
  Whole-response budgeting must account for the envelope and pretty printing;
  do not silently skip the highest-priority row to fit lower-ranked rows.

These are checked current projections, not filesystem-wide transactions or
claims that knowledge is true. Selected-input revalidation does not validate
every unselected candidate or prevent writes after the final check.

## Verification

Real disposable Vault tests cover private-only prompts/cadence, private-history
isolation, hidden state, stale source/private changes, read failures, bounded
metadata I/O, oversized prompts, malformed intervals and whole JSON budgets.
Run nearby suites, build, all tests with one worker, and diff checks. Commit
source and generated dist together, then push only the configured user fork.
