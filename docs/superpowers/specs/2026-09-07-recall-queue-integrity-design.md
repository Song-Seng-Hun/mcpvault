# Bounded current active-recall queue

## Goal and authority
Repair recallQueue as a trustworthy active-recall projection, retaining its
priority/round-robin neighborhood order. User delegated design and fork-main
implementation. No live Vault writes, new endpoint or client installation.

## Problems observed
The old queue bounds only its item array, retains every rich candidate, opens
private record bodies, resolves links for every due note and uses noteExists
without moderation checks. Sources/private records have no returned/rechecked
revision. Resolved repairs bypass the next due date, and arbitrary interval
metadata can overflow Date. These undermine both learning and resource safety.

## Design
Scan eligible notes with fresh strict metadata bounded by MAX_NOTE_CONTENT_BYTES.
Read only the caller's private recall metadata under the same access predicate;
errors do not silently become missing history. Retain at most limit groups of
limit ranked candidates. Track distinct group keys separately for exact observed
diversity counts (O(groups), not constant total memory). If there are more than
limit groups, only their highest-priority heads can enter the first round; with
fewer groups no bucket has been evicted. This preserves the old selected prefix.

Enrich only selected candidates. Use one request-local bounded reference reader
and syntax/source-aware resolver; filter hidden/missing/foreign targets before
ambiguity. Resolve repair paths without truncating identities. Attach current
source, private-state and visible reference revisions, then recheck them before
returning; missing private state must still be missing. Reject drift rather than
mixing observations. Counts describe sequential observations, not an atomic
Vault census. Resolving too many metadata identities fails with a bounded retry
error; no unlimited fallback reads.

Normalize intervals using the existing 1..3650-day contract. Invalid date or
interval metadata routes to its revision-bearing metadata repair action; resolved
repairs obey normal due dates. Preserve original reason values for valid input.

Pack the entire compact/pretty JSON response within maxChars. Keep a prefix of
whole candidates; compact the first item to its prompt/revision and repair action
when appropriate. If exact prompt/identity cannot fit, return bounded retry
overrides, never shorten a path or prompt into a different task. At the ceiling,
return a metadata repair or prompt-only action when it fits, otherwise an
explicit unavailable task, rather than an identical retry loop. No queue read
records a recall or reveals answer bodies. Oversized prompts use the existing
notes.read endpoint's optional string Property projection, with UTF-16 offset
pagination, whole JSON budgets and expectedRevision on continuations. Read only
fresh bounded metadata, not the answer or other Properties; do not suppress a
field/page using knownRevision. Missing/non-string values fail explicitly.
Review packets admit up to 12000 characters of recall context internally before
outer packing, preserving invalid-interval repair priority and follow-up actions.

## Alternatives and proof
Simple top-K would remove diversity; unbounded per-group lists keep the memory
problem. The bounded collector is tested against an exhaustive reference across
orders and group counts. Real temp-Vault tests cover JSON budgets (pretty too),
stale/hidden source and targets, private-state creation/change, repaired scheduling,
invalid intervals, source-relative references and read bounds. Build, full
single-worker tests, independent integrity review and explicit fork publishing
are required. A separate recordRecall write-path audit remains outside this
queue change; no claim that every recall mutation has been audited.
