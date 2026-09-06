# Bounded single-buffer metadata snapshot encoding

User design approval and fork-main delivery are delegated. Metadata snapshot
encoding currently builds UTF-8 buffers, length buffers, per-field concatenations,
per-entry numeric buffers, then a final concatenation. Encoding has no matching
preallocation cap even though loading rejects files over 128 MiB / 1M entries.

## Choice and boundaries

Capture the same synchronous serialization point but size the snapshot before
allocating its final Buffer. Retain serialized frontmatter strings and scalar
row fields, not encoded per-field byte buffers. Check entry count and cumulative
encoded size incrementally. Allocate one exact-size Buffer and directly write
the unchanged magic/version/count/length-prefixed UTF-8/double format.

An async streaming encoder would save additional peak output memory, but current
index list APIs can expose mutable entry references. Lazy JSON serialization
would mix states after async IO begins unless ownership changes more broadly.
Avoid that new race; serialization stays synchronous before existing temp-file
write/rename. No new compression or format migration in this increment.

Move the codec and its format constants into focused `src/metadata-snapshot.ts`;
use a structural snapshot entry interface and preserve the public VaultIndexEntry
type/export contract. Allow encode limits only to narrow the fixed production
ceilings (small tests need not allocate 128 MiB). Decode retains prior validation
and adds the same byte ceiling at its entry. No new dependency or public MCP API.

Malformed/nonserializable or oversized snapshots stay optional failures: preserve
the previous disk file and current authoritative in-memory index/source notes.
No filesystem write begins if encoding fails. No need to change snapshot locks,
debounce, close behavior, or permissions. This caps snapshot output, not total
process memory or the transient JSON string of one giant entry.

Prove RED via real index flush showing per-field Buffer.from/concat; compare
new encoded bytes to a trusted former codec over safe fixtures. Cover Unicode,
lone surrogates, empty/multiple entries, stable decode, numeric boundaries,
exact/over byte and count caps before allocation, serialization errors before
write, prior-snapshot preservation and subsequent recovery. Full sequential
single-worker tests/build, independent read-only review, explicit source/dist
commit and fork push with remote SHA verification. No live runtime/Vault edits.
