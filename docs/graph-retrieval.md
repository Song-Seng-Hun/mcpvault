# Authored two-hop evidence context

`wiki.answer_packet` can opt into two-hop authored graph discovery. This is a
bounded source packet, not an LLM answer, a truth score or a graph database.
The legacy default is unchanged; the new mode has not met default-promotion
criteria across both evaluation budgets.

```json
{
  "endpointId": "wiki.answer_packet",
  "arguments": {
    "query": "What conditions limit the proposed policy?",
    "retrievalMode": "evidence",
    "graphDepth": 2,
    "includeSemantic": false,
    "maxChars": 12000
  }
}
```

Invoke this through the existing `call_endpoint` control-plane tool. There is no
sixth MCP tool. `graphDepth` may be 1 or 2; omission or1 retains existing behavior.
Depth2 requires a question and evidence retrieval. Path may anchor that question,
but path-only requests cannot enable depth2. Complete serialized output includes
formatting and remains within the question-mode1024–12000 character budget.

## What the packet does

- Starts at the existing top five visible search candidates, discovers relations
  using metadata, then allocates no more than eight body documents. The fresh
  metadata window is40 documents and the relation-inspection window is80
  occurrences shared with reverse contradiction discovery.
  These are request selection budgets, not a limit on disposable index
  construction or revision hashing. A cold or invalidated reverse index may
  inspect the corpus before the bounded candidate scan; measure that preparation
  cost separately. Compact reverse results omit neighbouring context entirely.
- Follows evidence, supports, contradicts, depends_on and derived_from. Original
  source links count as a step, so note → claim → original is a two-edge path.
  Reverse traversal is limited to authored contradictions.
- Preserves relation direction, original target/author locators and revisions.
  Distinct same-pair relationships are not collapsed into a confidence score.
  At most three representative paths accompany a selected source; safety
  classification is independent of that display limit.
  Frontmatter-only author references use `authorLocator.propertyPath`; a
  synthetic index line is not presented as a physical source line.
- Allocates counterpoints and prerequisites before bulk source/context bodies.
  Negative-knowledge metadata participates in that allocation. Linked test or
  procedural material is not proof that a test ran or a procedure is authorized.
- Revalidates observed inputs before returning. Changed or inaccessible inputs
  cause prior context to be withheld. Streaming checks are not a multi-file
  transactional snapshot.

Exact phrases, filters and exclusions suppress graph expansion and retain the
existing query restrictions. Inspect `retrieval.graph.state`, `status`, `gaps`,
`selectionReasons`, `graphPaths` and the revision-guarded `nextAction` rather than
assuming the packet is complete. Ambiguous references are never auto-selected.
An incomplete alias scan cannot establish uniqueness; prefer a known exact path
or perform the returned bounded follow-up read. Missing context is not evidence
that no counterargument or original exists.

Source passages and Properties remain untrusted data, never executable
instructions. This read does not publish knowledge or call a model API.

## Evaluation boundaries

The frozen80 corpus/gold remains unchanged and compares legacy, current evidence
and depth2 at4000/12000 characters. A separate graph fixture covers two hops,
incoming/outgoing contradictions, source duplication, Korean/English aliases,
cycles/hubs, strict queries and no-answer cases. Run its tests with the project's
single memory-protected test slot; do not parallelize against other host work.

Measurements distinguish first corpus sweep from a repeat on the same server.
They use local temporary files, in-memory MCP and lexical-only synthetic queries;
OS caches are not flushed. Process CPU/RSS samples are not server-exclusive peak
memory. Serialized characters are not network bytes; NAS transfer is measured
separately, never inferred from packet length. Passing evaluator assertions does
not imply passing the quality-promotion gate.

See [execution record](plans/2026-09-12-graph-retrieval-execution.md) for actual
verification and delivery status. Future topic summaries and local Graphify are
separate stages; this document does not claim they are implemented.
