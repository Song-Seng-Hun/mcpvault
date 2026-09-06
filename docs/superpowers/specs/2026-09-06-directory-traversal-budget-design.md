# Tree-wide directory traversal budget

User design approval and fork/main integration are already delegated. Continue
reducing server-side maintenance cost without external services/client setup.

Both VaultFileCatalog.findPaths and the semantic fallback findMarkdownFiles use
recursive batches of eight. This limits siblings, not a complete tree: eight
children can each start eight grandchildren. The recursive result merge also
uses push(...paths), which can exceed the engine's function argument limit for a
large child inventory.

Give each traversal a budget of eight and partition it among each child batch:
floor(budget / childCount), plus one for the remainder's first children. Each
branch owns its budget until its entire recursive walk settles. Sum of active
branch budgets never exceeds eight; one-child chains retain the whole budget.
Use the budget as batch size and loop over individual paths when merging child
inventories. Keep order, cache generation checks, filtering and watched subtree
reuse unchanged. The semantic fallback also uses allSettled before propagating
failure, matching the catalog's existing safe sibling-drain behavior.

Alternatives: a central dynamic queue can use idle capacity more effectively but
adds ownership/cancellation complexity; a full serial walk minimizes concurrency
but loses bounded useful parallelism. Budget partitioning is small and preserves
existing recursive cache behavior. It can leave slots unused behind slow sibling
branches. The cap is per traversal, not process-wide; result arrays and cached
ancestor inventories still scale with corpus size/depth.

Verify both actual traversal implementations against a virtual filesystem at the
readdir boundary: 8x8 fanout must peak at <=8 unfinished reads and preserve all64
notes, and a 150,000-file child must merge without an argument-spread RangeError.
No files/models of that scale are written to disk. A deferred fallback error test
must keep scanPromise unsettled until a held sibling finishes, preserve pending
intents and leave the scan watermark untouched. Existing real-file catalog,
reconciliation, scope-filter and semantic integrity suites remain required.
Run build/full one-worker suite/review/diff validation, then push only user fork.
