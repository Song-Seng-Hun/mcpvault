# Known-directory reconciliation follow-up (2026-09-13)

The earlier [graph measurements](graph-index-measurement.md) exposed an expensive
alias scenario, but did not identify its cause. A real `fs.watch` boundary trace
on Windows showed a preceding deletion emitting both a note `rename` and a
parent-directory `change` (`Notes`). The latter called full invalidation, forcing
all remaining bodies to be reread during the next alias query. An additional
reverse-alias map would not fix that cause.

The targeted change classifies only `change` events for a known nonempty parent
directory as metadata reconciliation hints. It immediately enumerates membership
and stats, reusing existing size/mtime/ctime rules. It does not clear pending dirty
paths or a forced full read. Unknown filenames/paths, directory renames and watcher
errors retain conservative full rereads; the independent content audit remains.
This is not immediate byte verification if all three stat fields collide. Current
ACL filtering and authoritative Markdown revision reads remain separate.

## Standalone reproduction and measurements

Disposable local synthetic files only; no NAS production fixtures or data changes.
Node 22.23.2 on the same Windows host. Existing scenarios were retained, with three
extra isolated alias scenarios. Each mutation has one sample, not a stable p95.

| Scenario | 1,000 documents, ms / body reads | 10,000 documents, ms / body reads |
| --- | ---: | ---: |
| Earlier alias addition following deletion | 720.986 / 999 | 7092.242 / 9,999 |
| Fixed alias addition following deletion | 66.548 / 2 | 704.022 / 2 |
| Alias target only | 8.921 / 1 | 116.536 / 1 |
| Reference only | 11.377 / 1 | 98.699 / 1 |
| Target and reference, isolated | 10.644 / 2 | 109.065 / 2 |

The original expensive case now reads 69 body bytes at both sizes, versus
160,482 / 1,618,482 bytes before. A separate pre-fix 1,000-document diagnostic
reproduced 999 reads in 726.092ms with the actual watcher event trace.

Other post-change observations (1,000 / 10,000): cold index build
1629.168 / 20722.084ms; warm query p50 7.585 / 96.163ms and p95
9.518 / 179.162ms across eight queries; process peak RSS 124.43 / 207.77MiB.
The benchmark's sampled minimum free RAM was 4.965 / 3.112GiB. All occurrence,
revision, deletion, alias and permission assertions passed, external retries were
zero, and fixtures were removed. Host load differed between runs: these results
do not establish general latency nonregression, semantic quality or NAS speed.

Body-read instrumentation excludes directory/stat IO and SMB transport. Metadata
reconciliation still enumerates the vault; this is not an O(changed-documents)
filesystem census. Cold index does not mean cold OS cache. Dense overflow remains
covered, but 50,000 documents and alternative databases remain untested. No new
database or alias map was added.

## Safety and reproducibility

`graph-directory-events.test.ts` uses real Markdown files and the public graph
API, replacing only the watcher event boundary. It covers known-directory updates,
new file discovery, unknown/rename fallbacks, pending forced reads, independent
content audits, and ACL revocation through an unchanged predicate closure.
The first two tests failed before the runtime change by observing 31/33 reads
instead of one, then passed after it. Existing content-reconciliation, revision,
visibility and source-snapshot tests remain in the full test inventory.

Run `node scripts/benchmark-graph-index.mjs --notes 1000` (or `10000`) under an
appropriate host memory guard. The script refuses custom fixture paths. Full
delivery evidence belongs to the [execution plan](../plans/2026-09-13-safe-tests-graph-refresh.md).

## Shared-catalog production path

`createServer` supplies a shared `VaultFileCatalog`, so the standalone watcher
fix alone would not improve that path. A separate real-file reproduction retained
999 reads at 1,000 documents. The shared catalog now attaches an immutable,
host-internal `directory_metadata` context to the existing undefined/full batch
notification. Other indexes retain their conservative full-change behavior; no
additional watcher, permission grant or public endpoint is introduced.

The context preserves explicit dirty note paths coalesced before or after a
known-directory event. Graph hashes those bodies even when all stat fields match.
Unknown events and renames dominate hints in either order. Failed delivery,
including debounce-timer delivery, cannot downgrade an uncertain edit into a
metadata-only refresh. Full content audits and pending forced reads remain intact.
Hints do not turn size/mtime/ctime into byte proofs; they use the existing metadata
heuristic for otherwise unobserved changes. Authoritative revision/access checks
are not replaced by the index.

Final shared-mode comparison used the previous deployment's runtime (ad6059794)
and the combined modified build with the same fixture generator and installed
dependencies. This exercises the production graph/catalog topology, not the full
MCP server, NAS/SMB transport or simultaneous external load.

| Shared alias-add after deletion | Previous runtime | Modified runtime |
| --- | ---: | ---: |
| 1,000 documents, ms | 734.879 | 70.727 |
| 1,000 documents, body reads / bytes | 999 / 160,482 | 2 / 69 |
| 10,000 documents, ms | 6838.481 | 529.597 |
| 10,000 documents, body reads / bytes | 9,999 / 1,618,482 | 2 / 69 |

At 10,000 documents, modified target-only/reference-only/combined isolated alias
changes took 99.304 / 78.128 / 79.704ms with 1 / 1 / 2 body reads. Warm p50/p95
was 76.012 / 102.247ms over eight queries (previous: 77.783 / 106.008ms).
Peak RSS was 211.25MiB versus 210.17MiB: these single runs do not establish RSS
nonincrease or general latency guarantees. All correctness checks passed, no
external retries occurred, and fixtures were removed. Logical reads still exclude
stat/directory/SMB IO. Each mutation remains a one-sample observation.

Use `node scripts/benchmark-graph-index.mjs --notes 10000 --shared` to select
the shared fixture; omit `--shared` for the preserved standalone mode. The new
shared watcher tests cover explicit same-stat edits/moderation, event coalescing,
new-note discovery, current ACL, source-read failures, and delivery failure races.
