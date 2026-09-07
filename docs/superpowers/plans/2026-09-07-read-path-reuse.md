# Read path reuse implementation plan

> Execute inline with TDD and review; design/fork-main authorization is delegated.

**Goal:** Remove the measured duplicate synchronous resolution without weakening
path validation or changing read behavior.
**Architecture:** One checked path per read call; shared private stat helper.
**Tech stack:** TypeScript, Node fs, existing Vitest and benchmark.

- [x] Add `src/read-path-reuse.test.ts`: count real existing-target resolutions
  while preserving native filesystem behavior; require one call for bounded and
  unbounded reads/revisions and directory rejection. Exercise path denial,
  missing/read errors and junction retargeting between calls.
- [x] Run `npm test -- src/read-path-reuse.test.ts --maxWorkers=1` to RED.
- [x] In `src/filesystem.ts`, change withNoteRead to
  `await this.isResolvedDirectory(fullPath)` and extract only public
  isDirectory's stat try/catch into that private helper. Keep all resolver and
  PathFilter code untouched; public isDirectory delegates after its checks.
- [x] Run focused path/existence/streaming/filesystem and HTTP tests; build.
- [x] Repeat the local server-only profile and
  `node scripts/benchmark-shared-http.mjs` sequentially; record all observations
  and limitations, not only improved metrics.
- [x] Obtain read-only review, fix findings, then verify build, full
  `npm test -- --maxWorkers=1` and `git diff --check`.

Publication gate: commit only source, generated dist, tests and docs, push the
user fork main and compare local/remote SHA. Leave the broader Goal active.
