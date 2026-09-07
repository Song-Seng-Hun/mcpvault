# Graph query selection implementation plan

> Use executing-plans inline under delegated design approval; TDD before edits.

**Goal:** Reduce graph query comparison work and full-result intermediates.
**Architecture:** Existing bounded heap plus streaming output windows; unchanged
shared graph, authorization, validation and fingerprint contracts.
**Tech Stack:** Node, TypeScript, Vitest, existing createBoundedTopK.

- [ ] Create `src/graph-query-selection.test.ts`: synthetic entries and paths;
  bypass only IO refresh with an ensure spy. Use real graph query/resolver logic.
  RED comparison bound for 600 backlink authors and K=64, no `links.filter` for
  outlink window, no orphan object map/full sort for 600 unlinked notes.
  Run `npm test -- src/graph-query-selection.test.ts --maxWorkers=1`.
- [ ] Modify `src/vault-graph.ts` backlink selection:
  `createBoundedTopK<{link:BacklinkMatch;order:number}>(offset+limit, (a,b) =>
  compare(a.link,b.link) || a.order-b.order)`; add each accepted row once and
  project `values().slice(offset,offset+limit)`. Remove addTopMatch.
- [ ] Stream outlinks: count eligible edges, collect selected raw links only,
  add every eligible link to optional NavigationViewFingerprint; keep full
  target-validation collection and post-await checks; project returned page.
- [ ] Stream orphans: `incoming = new Set<string>()`, add nonself resolved note
  destinations; scan sorted notePaths, count/add fingerprint for zero incoming,
  push rows only when `total > offset && orphans.length < limit`.
- [ ] Extend tests: deterministic tie pages, offsets beyond total, hidden
  source/target filtering, whole-view fingerprints identical across pages,
  dependency validation outside page, rejection after async generation/scope
  changes. Assert original synthetic entries stay unchanged. Target graph,
  navigation and search-limits suites plus new file before build.
- [ ] Run build, independent read-only review, full single-worker tests and
  git diff --check. Document exact resource improvement/limits in README and
  evidence here. Explicitly stage source/generated dist/doc files; commit and
  push only user fork main, verify remote SHA. Leave Goal active.
