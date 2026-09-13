# Revision-pinned relation occurrences

`wiki.neighborhood` optionally accepts `view: "assertions"`. Omission or
`view: "neighbors"` keeps existing behavior. Assertions are a read-only outgoing
view of one visible Markdown note, not a full graph or new MCP tool.

Each returned occurrence has a source repository/document/version identity,
source path/revision, optional normalized claim ID, relation and authored
direction, target path/current revision, and a Properties path or body-relative
line/occurrence locator. Same-pair supports/contradicts and repeated links remain
separate. IDs based on repository/path do not survive renames; unchecked
`stable_id` is never a global identity key. Source identities are opaque hashes,
not a disclosure of the physical host or NAS path.

Properties are `authored`; parsed links are `extracted`. No inferred assertion is
generated or published. `evidenceState: not_verified` always remains separate
from `validation.state`: current locators only mean current visible endpoints and
supported locator syntax. Duplicate/missing source claim anchors, target-kind
mismatches and missing target anchors require review. An unperformed body check
is `not_checked`, never a pass. This is not claim promotion, truth scoring or a
claim of independent source corroboration.

## Bounds and non-disclosure

- Up to80 private occurrence candidates,40 returned records(default12),64 fresh
  metadata admissions and8 body admissions. Each note read is at most1MiB.
- Existing reference resolution handles exact paths, source-relative Markdown,
  titles and aliases. A capped alias scan cannot establish uniqueness. Path
  inventory enumeration is **not** bounded by the metadata-read limit.
- Final inventory-backed resolution and revision/access checks discard changed,
  removed or revoked context. This is optimistic revalidation, not a NAS-wide
  atomic snapshot. Matching code fences/examples use existing parser behavior.
- Only uniquely resolved, currently visible target identities are serialized.
  Raw candidates, aliases, labels, hidden counts and unavailable-target details
  are never returned. Hidden and missing targets share one incomplete state.
- `maxChars`512–16000 covers the final compact or pretty JSON. Budget removal
  keeps `partial` and a revision-pinned `notes.read` action for the root. If even
  that locator cannot fit, the request fails without a path-bearing error.
- Coverage is outgoing-only; global integrity and evidence verification are
  always false. Read-only mode accepts this operation and nothing is written.

`graph-validation.ts` extracts existing claim normalization, reference parsing
and block-anchor indexing unchanged from the legacy service. Its five local
profile descriptions identify the existing lint/preview checks. The existing
severity, alias, evidence, dependency-cycle and MOC-cycle policies remain with
those services; there is no new mandatory write constraint or SHACL/RDF engine.
Related cycles are not dependency cycles; `same_as` is not OWL equality.

## Host-only Graphify adapter

`adaptGraphifyAssertions` consumes the existing P3 bounded `query_graph` result
from pinned Graphify0.9.58/adapter1. It does not invoke an AST parser, model,
provider, subprocess, network service or Vault endpoint. A trusted host supplies
the matching repository identity, explicit current path allowlist and a fresh
source-byte SHA256 reader with local path/link checks. It revalidates all selected
source revisions before and after conversion; stale/missing/revoked inputs fail
closed. Do not supply cached or packet-claimed hashes as the reader.

The result retains source and target document/version/symbol identities and each
returned occurrence ID/location. Missing locations remain unspecified. These
are **host-private structural candidates**, not public ACL-safe MCP output.
Neither raw labels nor parser payloads are copied. `testStatus: not_executed`
and `partial: true` remain explicit: upstream may already deduplicate identical
payloads, and structural test references do not prove successful execution.
No CLI hook, trust setting, extraction allowlist or production host is enabled
by this adapter. The P3 raw inventory and clustering projection remain separate.

Tests: graph-assertion, graph-validation, graph-assertion-packet,
graph-assertion-mcp, graphify-assertion and adjacent neighborhood/claim tests.
These references identify checks; execution receipts are separate in the
implementation record. Actual model quality and native Codex hook activation
remain outside this graph delivery.
