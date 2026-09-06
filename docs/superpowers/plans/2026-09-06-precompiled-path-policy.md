# Precompiled Path Policy Implementation Plan

> For agentic workers: executing-plans inline with independent security review;
> design/main integration are explicitly user-approved.

**Goal:** Remove per-path reconstruction of immutable filtering policy.

**Architecture:** Instance-owned readonly RegExp array and normalized extension
array, with the exact existing path-safety and glob semantics.

**Tech Stack:** TypeScript, RegExp, Vitest.

- [ ] Add `src/pathfilter-compilation.test.ts`. In a synchronous try/finally,
  proxy global RegExp construction then restore before assertions. Verify
  constructor compilation count10+customCount and no additional compilation for
  200 listing/allowed checks. Add instance/config isolation, literal/anchored
  wildcard, canonical path and repeatability expectations; no model/server IO.
- [ ] Run targeted tests and observe RED for per-path construction. Modify
  `src/pathfilter.ts`: ignoredMatchers readonly RegExp[], constructor copied
  patterns map compileGlob; old simpleGlobMatch returns the regex from unchanged
  translation rather than testing per call. isIgnoredPath uses matcher.test on
  both path forms. Lowercase copied extensions in constructor and candidate once.
- [ ] Run PathFilter/filesystem/security-related targeted tests, build and large
  virtual-directory tests. Document semantics and work-count evidence in README;
  no production latency/RAM claim. Obtain independent review for permission drift.
- [ ] Full `npm test -- --maxWorkers=1`, diff whitespace validation, explicit
  source/tests/docs/dist commit and fork-only origin main push after verification.
