# Precompile immutable path policy

User-approved design/main integration continues resource-cost reduction. The
150,000-path traversal regression takes roughly seven seconds of synchronous
filter/sort work. Inspection finds ten default ignored globs rebuilt into RegExp
objects on every normalized/canonical match, up to forty compilations per note
for listing plus allowed checks. This is repeated policy work, not necessary
current-file validation.

Compile copied default/custom patterns once per PathFilter instance with the
exact existing escape/wildcard/anchoring/case-insensitive transformation. Preserve
both normalized and canonical path comparisons, platform syntax rejection, hidden
segments, restricted names and extension behavior. Regexes must not have global
or sticky flags/state. Normalize copied extension strings once and lowercase the
candidate once for the extension loop. Do not cache path decisions, share mutable
configuration across instances, weaken guards or add client configuration.

The configuration contract is string[] for both fields. Invalid non-string
entries may now fail at construction rather than later matching/short circuit;
valid-input decisions must remain equivalent. Readonly/private fields are the
TypeScript contract, not runtime freezing against deliberate internal tampering.

Alternatives: cooperative yielding/worker threads reduce blocking but still do
the same repeated regex construction; path-result caching adds invalidation and
confidentiality concerns. Remove the duplicate computation first. Rules consume
O(configured patterns) storage per instance rather than allocations per path;
total corpus memory and event-loop latency are not thereby bounded.

Regression evidence: instrument actual RegExp construction through a temporary
restored constructor proxy and verify compilation occurs only during constructor,
not hundreds of repeated path checks. Test separate instances, caller mutations,
repeatability and both normalized/canonical paths. Existing broad PathFilter,
filesystem, scoped-access and directory traversal tests remain required. Run
targeted/build/full one-worker/review checks and push only the user's fork.
