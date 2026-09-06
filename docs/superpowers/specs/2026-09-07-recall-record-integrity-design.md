# Recall recording integrity

The user delegated design approval and fork-main implementation. Previous queue
delivery is 7b52845. This increment repairs recordRecall; no live Vault writes,
new MCP tools, client setup, upstream PR or model downloads.

## Findings and choice

The private branch ignores the caller's source expectedRevision, defaults from
shared rather than private Properties, truncates authored prompts, and re-reads
the target to form a receipt. It can report another write's state. Private state
has no caller-visible compare-and-swap input despite the queue returning its
stateRevision.

A read-time comparison alone leaves a check/write window. A new transaction
engine duplicates existing filesystem machinery. Reuse
writeNoteWithRevisionGuardsAndReceipt: source guard plus private target CAS,
with the current FileSystemService mutation locks. This guards cooperating
mutations, not a filesystem-wide transaction against arbitrary external editors.

## Contract

- Fresh strict metadata reads have an 8 MiB source cap. Hidden source or private
  state is unavailable; access and path rules remain in force.
- The existing filesystem revision assertion used parsed unbounded readNote.
  Reuse readNoteRevision(path, maxBytes) instead. Recall passes an explicit
  maxBytes policy through guarded writes and Properties receipts; ordinary
  operations omit it so oversized-note shrinking/trashing remains possible.
  Preserve path/lock checks. Avoid parsed copies solely to compare a hash.
- expectedRevision is the SHA-256 of the knowledge note for both branches.
- For agents, a new record allows omitted expectedStateRevision or 'missing'.
  Updating an existing record requires its current SHA-256; queue stateRevision
  and mutation receipts provide it. Stale or missing guards fail before writing.
- With no replacement, prefer private recall_prompt and recall_interval_days,
  then shared values. Do not shorten an existing authored question. An explicit
  replacement must be a nonempty string <=1000 chars. Oversized inherited prompts
  are preserved in storage but omitted from receipts with promptOmitted:true.
- Use write receipts for revision and locally prepared history counts. The
  shared branch uses updateFrontmatterWithReceipt. No post-write disk read is
  described as this operation's revision.
- Existing scope rules, bounded history (32), evidence/lifecycle independence,
  and read-only rejection are unchanged. Repair-target semantic validation is
  outside this focused source/state recording change.

## Proof

Real temporary Vault tests: stale source, source change before guarded write,
missing/stale private guard, concurrent first creation, private-only prompt and
cadence, exact long prompt preservation, hidden sources/state, bounded reads,
receipt provenance after an intervening write. MCP integration exercises the new
argument through call_endpoint and preserves the fixed five-tool surface.
Run focused tests, build, single-worker full suite, independent review and
diff check before explicit commit/push to the user's fork main.
