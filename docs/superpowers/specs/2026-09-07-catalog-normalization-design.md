# Cooperative catalog normalization and discarded-sort avoidance

User has delegated design approval and fork-main integration. Previous batch
covered filtering/merging; two native Dirent-to-entry maps still block until
finished, and refresh sorts inventories even when their generation is obsolete.

## Chosen design

Reuse forEachInventoryItem for both watched/unwatched normalization paths.
A private normalizeDirectoryEntries helper accepts actual Dirents, pushes compact
name/directory/file records in order, and checks catalog liveness at checkpoints.
No chunk copies, workers, configuration, model loads, or live server changes.
Check closure again after awaiting normalization, including the small-array
microtask boundary. Capture readDirectoryEntries generation before IO; do not
clear dirty markers or publish entry caches if that generation changed.

In refresh, return before both native sorts when generation already changed.
Keep the existing publication generation check and bounded reconciliation loop.
Stable inventories retain the exact localeCompare ordering and two inventories.

Alternatives: worker transfer adds memory/lifecycle complexity; custom cooperative
sorting adds buffers and ordering risk. Both remain separate measured decisions.
This batch improves cooperative responsiveness and avoids provably discarded
sort work, not asymptotic full-census storage or native IO/sort latency bounds.

## Evidence required

Real temporary 600-file directories and actual Dirents. Instrument only the
readdir boundary to observe isDirectory calls and schedule precise immediate
callbacks. For watched and unwatched modes prove first callback sees 256 items,
close stops conversion and cannot revive caches, and delivered file creation
forces reconciliation with current membership. For watched mode verify dirty
marker/cache ownership survives invalidation during normalization. Instrument
real inventory arrays' sort methods to prove an obsolete census is not sorted
while its stable retry is sorted once per array. Full one-worker regression,
build, independent review, whitespace check, explicit files and generated dist
only; push user fork, never upstream.
