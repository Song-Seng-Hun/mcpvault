# Cooperative catalog processing

User design/main approval is delegated. Terminal catalog close is now verified;
continue with event-loop cooperation during expensive inventory filtering and
child-array merging. No new worker processes, client setup or parallel CPU work.

A small internal inventory iterator processes at most256 items synchronously,
awaits node:timers/promises setImmediate between batches, and checks the owner's
open guard before work, after every yield and at completion. Callbacks are
synchronous, source arrays are immutable-by-convention snapshots, and no chunk
array copies are allocated. Use it for catalog entry filtering and both child
inventory merges. Recheck open at caller publication/dispatch boundaries too.

Keep iteration order, final sorting, path filters, subtree budget8, generation
checks and bounded reconciliation retries. A delivered invalidation during a
yield invalidates that census; an unfinished snapshot is never public. Close
during a yield aborts without further filtering/publication or new directory IO.

Alternatives: worker-thread transfer duplicates path arrays and complicates
ownership; adding Promise.resolve microtask yields does not guarantee IO/timer
progress. Real setImmediate yields are the chosen bounded-work checkpoints.
This is an item count, not a time/CPU/memory limit: callbacks, native readdir
normalization and final built-in sorts can still block. Those remaining phases
need separate evidence-driven work; this does not claim complete latency control.

Real600-file fixtures verify an immediate scheduled from the first filter runs
after256 entries, not600; closure at that point rejects without processing the
rest; a note added plus invalidated during that yield is present in the final
stable inventory. Direct helper tests cover merge order, synchronous errors,
empty input, closed guard and no unnecessary macrotask for small arrays.
Retain existing close, reconciliation, large inventory and scope/filter tests;
build/review/full one-worker suite before fork-only commit/push.
