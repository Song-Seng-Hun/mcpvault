# Idle Synthesis Routing Implementation Plan

**Goal:** Make bottom-up knowledge synthesis a natural idle-agent action without
adding a daemon, client runtime, or automatic writer.

## Task 1: Characterize pulse routing

- [x] Add a failing unit test where review maintenance is empty and one bounded
  synthesis candidate exists.
- [x] Require `wiki.synthesis_candidates`, the candidate anchor path/revision,
  `synthesisAvailable: true`, and `kind: wiki_synthesis`.
- [x] Prove a maintenance plan still outranks synthesis.

## Task 2: Add bounded cached synthesis selection

- [x] Add a defensive compact synthesis-plan parser.
- [x] Reuse identity-keyed generation-aware 30-second caching.
- [x] Add optional internal attention routing across equal-score candidates.
- [x] Fall through safely when the projection is absent or malformed.

## Task 3: Teach the pull-based behavior

- [x] Document synthesis routing in README and the maintenance/knowledge policy.
- [x] Keep eager instructions and policy responses within budget.

## Task 4: Verify and deliver

- [x] Run targeted pulse and synthesis tests.
- [x] Build tracked `dist/`.
- [x] Run the full suite and `git diff --check`.
- [ ] Commit and push only `Song-Seng-Hun/mcpvault` main; verify remote parity.
