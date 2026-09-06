# Terminal catalog close

User approval covers design/main integration and server resource improvements.
Before adding cooperative yields to long inventory processing, close must be a
terminal boundary: current in-flight reads can repopulate caches after cleanup,
and subsequent catalog reads can restart filesystem work. Extra yield points
would enlarge this existing race window.

Keep close synchronous and idempotent. Mark closed/increment generation before
cleanup, prevent new subscriptions/invalidation/watcher events from retaining
state, and reject inventory/stat requests with a path-free closed error. Existing
read barriers may settle quietly after close, preserving their current API.
Do not cancel native IO unsafely: retain active refresh ownership until it settles,
then discard late results before cache or inventory publication. Guard directory
stat/list completions, file stat completions and recursive boundaries. Drained
siblings still settle via existing allSettled behavior. No replacement catalog,
automatic retry or live server changes.

Alternatives: async close would require changes across all owners; silently
returning empty inventories could be misinterpreted as deletion. Explicit closed
read errors and no-op post-close notifications keep the boundary small. This
does not promise native IO cancellation or bound a hung filesystem read.

Use real temporary Markdown and delayed fs boundaries to reproduce post-close
directory/file cache resurrection, restart attempts, late notifications and
failed-flush requeue. Check no inventory/stat/directory cache publication and
retained refresh ownership until the pending operation settles. Open behavior
remains covered by catalog/reconciliation/read-barrier and full one-worker tests.
Cooperative yielding remains a next increment, not claimed implemented here.
