# From a source to existing knowledge

Use `wiki.source_compare` before turning a newly ingested source into another
Wiki note. It is a read-only dynamic endpoint behind `call_endpoint`; public
comparison needs no account, and the fixed MCP tool list still has five tools.

## Agent flow

1. Ingest an immutable source using the existing source endpoint. Copy its
   returned `path` into `sourcePath` and its `revision` into `expectedRevision`.
2. Compare one focused topic or claim, rather than submitting the entire source
   as a query:

   ```json
   {
     "endpointId": "wiki.source_compare",
     "arguments": {
       "sourcePath": "_sources/retry-v2.md",
       "query": "retry idempotent payment",
       "maxChars": 4000
     }
   }
   ```

   The example omits `expectedRevision`; when you have just read or ingested
   the source, include that exact returned revision rather than inventing one.
3. Inspect the source and relevant candidate passages. Follow exact current
   `readAction`/`continuation`/`nextAction` objects without removing their guards.
4. Decide `already_covered`, `extend_existing`, `conflicting`, `new_knowledge`
   or `uncertain`. Explain the applicable conditions and unresolved questions.
   An overlap is literal text, a citation is a declared relation, and a
   contradiction is explicit authored metadata—not a server truth judgment.
5. With write authority, prefer updating a suitable existing note using
   `notes.change_set`: inspect its schema, dry-run the current-revision change,
   inspect the preview, then apply its fingerprint. Only a genuinely new
   interpretation needs `wiki.distill_source`. Retain the immutable source and
   exact revisions as provenance, and reread every written target.

If a source is private but a comparison candidate is public,
`integrationAllowed:false` prohibits copying that source into that destination.
Keep the interpretation in an allowed private scope. `integrationAllowed:true`
only describes reference-scope compatibility: it grants no write capability.

## Limits and failure meanings

- Defaults: 4000 whole-response characters, maximum12000, minimum2000;
  `includeSemantic:false`. Pretty printing is included in the budget.
- At most20 discovered candidates and8 full note bodies, including the source.
  The server reads each body once and uses current, bounded metadata for
  reference resolution. This is not an exhaustive Vault comparison.
- Partial passages and omitted candidates are marked. Source/candidate
  continuations open current outlines; the body-read limit points to an unread
  candidate. A response-budget omission points to an omitted candidate.
- `no_candidates` does not establish novelty. `semantic.state:unavailable`
  means optional semantic search failed; lexical results still remain useful.
- `source.integrity:verified` means its current content matches its declared
  SHA-256, not that the source is true. `mismatch` requires source review, never
  rewriting the digest to make the warning disappear.
- An exhausted alias-metadata window cannot establish unique reference
  identity. Missing observations in a truncated comparison are not absence of
  citations or counterarguments.
- Revision drift, deletion or revoked access rejects the comparison. Retry
  using current inputs; multiple files are not an atomic filesystem snapshot.

No script in a note is executed; source text is untrusted reference data. No
automatic publication, merging, task creation, external fetching, additional
model or permanent comparison ledger is introduced.
