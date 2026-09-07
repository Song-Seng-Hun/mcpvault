# Graph query selection implementation plan

> Use executing-plans inline under delegated design approval; TDD before edits.

**Goal:** Reduce graph query comparison work and full-result intermediates.
**Architecture:** Existing bounded heap plus streaming output windows; unchanged
shared graph, authorization, validation and fingerprint contracts.
**Tech Stack:** Node, TypeScript, Vitest, existing createBoundedTopK.

- [x] Create `src/graph-query-selection.test.ts`: synthetic entries and paths;
  bypass only IO refresh with an ensure spy. Use real graph query/resolver logic.
  RED comparison bound for 600 backlink authors and K=64, no `links.filter` for
  outlink window, no orphan object map/full sort for 600 unlinked notes.
  Run `npm test -- src/graph-query-selection.test.ts --maxWorkers=1`.
- [x] Modify `src/vault-graph.ts` backlink selection:
  `createBoundedTopK<{link:BacklinkMatch;order:number}>(offset+limit, (a,b) =>
  compare(a.link,b.link) || a.order-b.order)`; add each accepted row once and
  project `values().slice(offset,offset+limit)`. Remove addTopMatch.
- [x] Stream outlinks: count eligible edges, collect selected raw links only,
  add every eligible link to optional NavigationViewFingerprint; keep full
  target-validation collection and post-await checks; project returned page.
- [x] Stream orphans: `incoming = new Set<string>()`, add nonself resolved note
  destinations; scan sorted notePaths, count/add fingerprint for zero incoming,
  push rows only when `total > offset && orphans.length < limit`.
- [x] Extend tests: deterministic tie pages, offsets beyond total, hidden
  source/target filtering, whole-view fingerprints identical across pages,
  dependency validation outside page, rejection after async generation/scope
  changes. Assert original synthetic entries stay unchanged. Target graph,
  navigation and search-limits suites plus new file before build.
- [x] Run build, independent read-only review, full single-worker tests and
  git diff --check. Document exact resource improvement/limits in README and
  evidence here. Publication is recorded below. Leave Goal active.

## Evidence

- RED: all three new operation/allocation tests failed on old code (09:04:58
  local): 35,049 author comparisons for N=600/K=64; full links.filter invoked;
  600 mapped orphan rows for a 3-row page. All result assertions passed first.
- GREEN: initial 5 files / 40 tests passed. Expanded graph/navigation/source
  snapshot/moderation/visibility/search-limits selection: 7 files / 76 tests
  passed (09:07:54 local, 9.53s). New file includes 9 tests. Synthetic graph
  tests isolate query work; existing file-backed tests validate integration.
- `npm run build` and `git diff --check` passed.
- Astra High read-only review (Halley): no actionable correctness/security
  defects. Suggested strengthening the orphan allocation test beyond map();
  reviewer was closed after completion.
- Full `npm test -- --maxWorkers=1`: 190 files passed; 2,944 tests passed,
  2 skipped (2,946 total), 333.91s, terminal exit 0, 09:09:02 local start.
- After the full run, test-only strengthening added push/sort instrumentation:
  maximum retained orphan-result array length was exactly 3 for a 3-row page
  over 600 notes, with zero orphan-row sorting. The 9-test file passed again at
  09:15:08 local; production code/dist did not change after the full run.
- Comparison assertion is below 10,000 on that synthetic case, not a production
  latency/RSS or end-to-end complexity claim. Resolver construction, source
  validation and complete-view hashing have separate cost; all remain active.

## Delivery

- Implementation `9c22dd389153bef18d57414303fbea9583ab2865` was pushed to
  `https://github.com/Song-Seng-Hun/mcpvault.git` main. Live `git ls-remote`
  matched that SHA. Source, generated dist and docs were explicitly staged.
- No live Vault, configuration or running process was modified. Existing
  `.agents/` and `.mcpvault/` remained untracked and untouched. No upstream
  PR/contribution or release. This final receipt is documentation-only.
