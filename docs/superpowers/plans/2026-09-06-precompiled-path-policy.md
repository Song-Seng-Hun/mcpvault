# Precompiled Path Policy Implementation Plan

> For agentic workers: executing-plans inline with independent security review;
> design/main integration are explicitly user-approved.

**Goal:** Remove per-path reconstruction of immutable filtering policy.

**Architecture:** Instance-owned readonly RegExp array and normalized extension
array, with the exact existing path-safety and glob semantics.

**Tech Stack:** TypeScript, RegExp, Vitest.

- [x] Add `src/pathfilter-compilation.test.ts`. In a synchronous try/finally,
  proxy global RegExp construction then restore before assertions. Verify
  constructor compilation count10+customCount and no additional compilation for
  200 listing/allowed checks. Add instance/config isolation, literal/anchored
  wildcard, canonical path and repeatability expectations; no model/server IO.
- [x] Run targeted tests and observe RED for per-path construction. Modify
  `src/pathfilter.ts`: ignoredMatchers readonly RegExp[], constructor copied
  patterns map compileGlob; old simpleGlobMatch returns the regex from unchanged
  translation rather than testing per call. isIgnoredPath uses matcher.test on
  both path forms. Lowercase copied extensions in constructor and candidate once.
- [x] Run PathFilter/filesystem/security-related targeted tests, build and large
  virtual-directory tests. Document semantics and work-count evidence in README;
  no production latency/RAM claim. Obtain independent review for permission drift.
- [x] Full `npm test -- --maxWorkers=1` and diff whitespace validation.

Integration follows verification: explicit source/tests/docs/dist commit and
fork-only origin main push; verify remote tracking state in the handoff.

## Evidence

- RED: real RegExp constructor proxy observed initial0/checks9600 versus desired
  initial12/checks0. Config isolation and repeated semantic expectations were
  baseline-green before changes.
- GREEN: PathFilter compilation/existing PathFilter/directory traversal/filesystem
  suites passed 276 tests with one skipped, four files. Build and diff whitespace
  checks passed.
- Separate verbose directory run passed all nine tests; the unchanged 150k
  catalog case took 1,898ms locally versus 7,622ms in the preceding batch's run.
  This is a local before/after observation, not a controlled production latency
  or memory benchmark. Structural assertions/input size remain unchanged.
- Independent Astra security review found no valid-input allow/deny drift or
  stateful-regex issue. Existing '../**' traversal assertions independently cover
  normalized-only matching; the initial coverage question was withdrawn after
  inspecting those tests. Malformed non-string config's earlier failure timing
  is documented as outside the declared contract. Reviewer closed.
- Full one-worker suite: 2,403 passed, one skipped, 158 files, 279.28 seconds.
  No live Vault, server restart, model download or client setup changes performed.
