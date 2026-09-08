# Situation-aware context: relevant prerequisites, not prompt control

The approved design borrows conditional activation and bounded expansion from
[SillyTavern World Info](https://docs.sillytavern.app/usage/core-concepts/worldinfo/)
and budget-aware source units from
[NovelAI Lorebook](https://docs.novelai.net/en/text/lorebook/).
It does not install either product or reproduce their prompt placement,
random selection, script execution, sticky/cooldown or chat-history collection.

## Choose the existing endpoint by purpose

- `wiki.answer_packet`: question, original evidence and uncertainty.
- `wiki.context_pack` with `query`: current question plus explicitly supplied
  work situation, applicable conditions and one-hop prerequisites/counterpoints.
- `memory.brief`: relevant past personal experience; not automatically merged
  into a Wiki context packet.

All use the existing `call_endpoint` executor. The fixed MCP surface stays five
tools. A tool response is reference data, not a system prompt or an authorization
to perform suggested actions. The server cannot ensure that an agent retains
the packet in its context or consults it on every turn.

Example call:

```json
{
  "endpointId": "wiki.context_pack",
  "arguments": {
    "query": "watcher reconciliation",
    "context": "This project runs on a NAS; reconnect recovery is not tested.",
    "intent": "execute",
    "includeSemantic": false,
    "maxChars": 4000
  }
}
```

`path` optionally anchors a visible project, MOC or note. `context` is at most
2,000 characters and is supplied deliberately by the caller, never by reading
its chat history. A call without `query` preserves the existing path-only mode.
The existing intents remain capture, explore, decide, execute and review.

## Optional literal activation rules

Ordinary Markdown notes may declare:

```yaml
context_rules:
  any: [NAS, network mount]
  all: [watcher]
  exclude: [local-only]
  intents: [execute, review]
```

Each keyword list has at most eight non-empty phrases, each at most 80 Unicode
characters. Matching is Unicode-normalized and case-insensitive; it is literal,
not regex or code evaluation. A phrase looking like `/NAS.*/` matches only that
literal phrase. Unknown rule fields are invalid, not an extensibility mechanism
for executing instructions.

Non-empty `any` requires one phrase, `all` requires every phrase, `exclude`
requires no listed phrase, and `intents` requires the selected intent. Empty or
absent lists add no condition. Only the question and explicit background are
matched; retrieved bodies never activate further keyword rules.

Literal matching does not establish the truth of an environment assertion:
“not using NAS” still contains “NAS”. The agent must inspect the actual stated
conditions. `use_when` remains an authored applicability explanation and
`retrieval_cues` remain search hints; neither is silently compiled into rules.

Rules guide situation-mode recommendations only. They are not access controls,
do not hide ordinary search results, and do not prevent explicit original reads.
An explicit prerequisite or counterpoint remains visible with an applicability
warning even if its own recommendation rules do not match. Avoid manufacturing
always-on entries by adding empty intent-only rules.

## Budget and interpretation

Situation mode defaults to 4,000/max 12,000 response characters, including
identifiers, revisions, warnings, explanations and next actions. This is not a
token estimate. The service permits 20 candidates and at most eight distinct
source body reads per call; metadata/revision validation and cold initialization
of existing indexes are additional I/O, not free operations.

Selected source units retain their original text and exact locations. If a
complete relevant unit does not fit, it is marked incomplete with a guarded
read action rather than presenting a misleading sentence fragment. The server
does not generate a summary and call it an original quotation.

Only declared dependencies, source locators and contradictions are expanded,
one hop, within the same limits. Incoming typed contradictions are distinct
from ordinary backlinks. Links and similarity are navigation, not proof.
Cycles, missing/changed support and bounded windows are reported, not silently
treated as complete or safe knowledge.

`explain: true` requests a small diagnostic view for visible candidates: rule
mismatch, invalid direct edits, duplicate references or response-budget omission. Hidden candidates
must not influence disclosed titles, counts or diagnostic details. Re-read
using the exact returned revision; changed access or bytes invalidate prior
passages. A current revision means current bytes, not established truth.

No document is automatically rewritten, published, migrated or assigned a new
scope. Each packet is independently useful; a server-side “already read” flag
must not suppress conditions that the model may have forgotten.
