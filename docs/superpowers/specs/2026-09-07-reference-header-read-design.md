# Header-only fallback reference discovery

The user delegated design approval and fork-main delivery. Existing no-index
`FileSystemService.findPathsForNoteReference` reads every full note but only
uses title/aliases/preferred_term/stable_id. It also filters paths before all
asynchronous work without rechecking revoked candidates afterwards.

## Choice

Reusing full-file hashed metadata would save retention but add unused hashing
to this path. A whole-string read preserves unnecessary disk and memory work.
Choose an early-closing header reader using the current HeaderCollector and a
64 KiB decoded UTF-8 buffer. This resolver returns paths, not a revision receipt;
it can stop after a closed header or recognized non-opener without pretending
to verify unseen body bytes. Do not use this reader for revision-bearing reads.

Add a read-only collector completion getter consumed by a real header-reader
function. Open/stat a regular file, decode chunks, feed collector, stop/close on
completion or EOF. Preserve decoder end handling for unclosed/malformed text.
No new header truncation, source cap or parser dialect: giant/unclosed headers
retain the prior full-text behavior. No GPU, process, client setup or MCP API.

Schedule header reads through the existing coordinator with a distinct header
operation/path key; share in-flight immutable strings, never completed caches.
Fallback reference batches remain 32-wide. Keep the indexed branch, scope/path
normalization, error-as-unreadable omission, alias ambiguity and sort order.
Check path filter/access before each scheduled read, after it, before building
the request-local reference index, and through canReference during final
resolution. Do not let an earlier candidate revoked during later reads leak or
influence candidate selection. This does not add new moderation policy.

Proof: pre-change RED for oversized parser input and access revoked while
parsing/after an earlier candidate. Real file tests show at most one initial
64 KiB read for ordinary small headers/plain notes, reads beyond one chunk for
long headers and all required input for unclosed headers, correct multibyte and
delimiter splits, finally-close on read errors/early return. Check identical
alias/path/relative/Markdown/ambiguity results, missing/error omission, scheduler
key separation and one active admission. Run build, focused/full sequential
tests and independent review. Keep dist with source and publish only fork main;
no live Vault/server/config changes or claim of runtime redeployment.
