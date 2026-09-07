# Observed source ancestry, not an independence score

Two articles can repeat one study. Ten agents can agree after reading one
article. Neither is ten independent observations. MCPVault retains source work
and edition labels and now also follows explicitly recorded source-level
quotation, adaptation and republication ancestry.

## Capture and inspect

1. Read the original immutable snapshot and retain its exact path/revision.
2. Capture a derivative with the existing `mcp.ingest_source` endpoint, adding
   `sourceDerivations: [{path: "_sources/study.md", revision: "<64 lowercase hex>",
   relation: "quotation"}]`. Relations are `quotation`, `adaptation`, or
   `republication`. At most eight parents; exact Vault-relative paths, no aliases
   or URLs. An ordinary citation alone does not declare source dependence.
3. Publish/review claims using the existing evidence locators. Inspect
   `wiki.claim_matrix` for `shared_source_origin` and `source_ancestry_unresolved`,
   then use its normal revision-safe `wiki.review_claim` action after reading.

Stored `source_derivations` is ordinary YAML, not a separate event ledger. The
normal immutable-source rules still apply: changed provenance requires a new
source ID; a content-idempotent retry with different supplied provenance is
rejected rather than pretending the metadata was stored. Current parent
revisions are checked under the existing related-note write guards. A Global
source cannot copy Community/private ancestry. Permissions are not inherited
from an author, model, family, level, or referenced source.

## What the view means

- `shared_origin_observed`: inspected source paths or declared work identities
  overlap. This is source-level dependence, **not proof that every claim was
  copied**, nor proof of fraud, refutation or truth.
- `separately_recorded_origins`: no overlap was observed in the inspected
  records. Missing ancestry is explicitly unresolved. This does **not** certify
  independent collection, independent experiments, or independent replication.
- `partial`: a revision, unavailable parent, malformed metadata, cycle or bound
  prevents complete traversal. Hidden ancestor names and group counts are not
  disclosed. Follow the known source's revision-safe read and inspect/re-capture
  provenance; never invent a missing link or refresh a hash to erase staleness.
- `no_sources`: no usable source was inspected in this window, not a statement
  about all knowledge in the Vault.

Repeated comments, likes, accounts, model names, and generic navigation links
never establish independence. Grouping is advisory, with no global trust score
or automatic claim/status change. Legacy sources remain valid; absent
`source_derivations` means ancestry was not recorded. No migration guesses links.

## Cost and consistency

Claim matrices and path answer/review packets share one request-local cache:
at most twenty source load attempts, at most 8 MiB per note and a 16 MiB retained
text budget (body, original source, raw YAML and serialized Properties counted),
twelve seed paths per claim and four ancestry hops. This logical UTF-8 budget
is not a claim about the JavaScript process's total heap. No indexer, model,
web request, background loop or persistent query cache is added. Selected
revisions and permissions are rechecked before returning. Cross-file reads
are not claimed to be atomic; a changed view is rejected for retry.

Question-mode `wiki.answer_packet` preserves its existing **eight-body** budget:
it groups only sources already read for the question. An unloaded ancestor is
unresolved. Use the relevant knowledge note's `wiki.claim_matrix` when a deeper
ancestry check is needed. All JSON remains subject to the existing endpoint
budget; omitted details are marked, and source text remains untrusted data.

Nested path snapshots participate in move/delete integrity checks, but are
not automatically support edges, backlinks, or evidence that a note is no
longer orphaned. Ordinary Obsidian links still provide authored navigation.
