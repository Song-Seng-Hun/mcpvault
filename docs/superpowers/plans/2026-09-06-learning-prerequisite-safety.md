# Learning prerequisite and checkpoint safety

## Reproduced defects

1. Graph-health relative claim resolution used a direct path lookup that
   bypassed source-to-target scope checks. A reader owning model and agent
   scopes could see model knowledge incorrectly validated against agent-only
   evidence. Public explicit _scopes links were already rejected by parsing.
2. That lookup chose Base.md when Base.markdown also existed, and appended
   .md to an explicitly authored Base.md when only Base.md.md existed.
   Learning-path resolution rejected these cases; health omitted the issues.
3. Actual recommended continuity saves accepted dependency-cycle nodes despite
   the contract to reject cyclic/blocked sequences.
4. More than 200 repeated links exhausted a MOC scan before a final unique
   document. Omitted distinct entries stayed zero, permitting a false complete
   learning checkpoint containing only the scanned prefix.

## Implementation

- Remove the duplicate graph claim lookup. Reuse the shared resolver with its
  exact extension, ambiguity and canReference checks.
- Checkpoint-only learning projections expose the acyclic recommendation list
  and scan truncation flag. Public diagnostic order keeps blocked nodes for
  inspection; authored order remains a deliberate reading option.
- Continuity refuses truncated scan snapshots before writing. Existing
  recommendation completeness checks now see omitted cyclic/blocked entries.
- Resume validation uses the same checks and returns stale/recovery guidance
  without changing the checkpoint or offering a next read.

## Verification

- Three graph parity fixtures failed before removal of the direct lookup.
- Two real continuity save fixtures accepted unsafe/partial routes before the
  fix; they now reject without creating a checkpoint.
- Two additional real resume fixtures retain the saved revision and provide
  explicit cycle/truncation reasons after path changes.
- Astra found an additional silent 30-item note-dependency cutoff. A second
  red fixture confirmed the same issue at the 20-item per-claim cutoff.
  Both now probe one additional valid entry, retain bounded processing, set
  truncation and make prerequisiteCoverageComplete false. Exact-limit inputs
  remain accepted; oversized saves/resumes preserve the previous checkpoint.
- Targeted MOC and continuity suites: 21 passed. Build and diff check passed.
- Final full suite: 1397 passed, 1 skipped, 104 files (63.37 seconds).
- Compiled dynamic MCP smoke verified incomplete dependency diagnostics,
  rejected save, stale resume without next read, and unchanged stored revision.
  Owned temporary Vault and account removed.
- Astra re-reviewed its blocker and the per-claim counterpart: no additional
  findings in the bounded review. Reviewer closed.

No new MCP tools, client configuration, live Vault mutations or automatic
knowledge promotion. Markdown and stored historical revisions stay authoritative.
