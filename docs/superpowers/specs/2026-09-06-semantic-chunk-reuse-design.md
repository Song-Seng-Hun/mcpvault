# Bounded same-note embedding reuse

The user explicitly approved the previously proposed design in Goal mode.
No further approval gate is pending for this implementation. Keep the existing
fork main, fixed MCP surface, server-side execution and resource limits.

## Contract

Persist a content fingerprint and embedding profile with each existing LanceDB
row, not in a new cache or a per-chunk manifest array. The profile includes the
immutable model commit, runtime versions, q8 CPU execution, mean pooling,
normalization, dimensions and input-prefix contract. Pin the model to
`761b726dd34fb83930e26aab4e9ac3899aa1fa78`, verified from the
[official commit](https://huggingface.co/Xenova/multilingual-e5-small/commit/761b726dd34fb83930e26aab4e9ac3899aa1fa78).
Unknown runtime identity must fail closed for cross-process reuse.

For a changed source, read at most 65 old rows (64 valid chunks plus an overflow
sentinel) from the same path and scope table. Match exact chunk input digests
and profile; reject wrong-path, malformed or nonfinite/dimension-mismatched
vectors. Overflow or lookup failure means cache miss, never a source failure.
Compute only unmatched inputs with existing batches of eight. Rebuild every row's
ID, source hash, line, title, wiki flag and timestamp from the current Markdown.
Keep the post-embedding source hash check and current query permission/hydration
checks. No cross-note/private-scope reuse or new persistent RAM cache.

## Upgrade and failure behavior

Add nullable string columns to existing scope tables before replacement writes;
legacy rows have no profile and cannot be reused or treated as current vectors.
Manifest entries carry one profile identifier per note so stat-equal legacy
entries are still queued for bounded idle rebuilding. Query only the current
profile. Failure to read/migrate/write a derived table remains semantic-only
unavailability with lexical search independent; never delete source Markdown.
The first pinned-model use may need a revision-specific server-side download.
No download, GPU execution or live-Vault reindex occurs during tests.

## Success evidence

Real temporary LanceDB and Markdown tests with only inference substituted:
metadata-only edits perform zero new embeddings; a 64-chunk note changing one
chunk performs one instead of 64; reordering retains correct current anchors;
changed identity/legacy/corrupt vectors and scope changes miss safely; source
edits during inference cannot publish stale rows; restart preserves eligible
reuse. Model-loading options are tested separately without network/model load.
Run focused tests, full suite with one worker, build, diff check and independent
review before fork-only push. Do not claim a measured wall-time/RSS/GPU win from
inference-input count alone.

## Non-goals

GPU, ANN, multicore worker pools, snapshot streaming and queue redesign are
separate candidates. This change prevents repeated work, not all resource use.
