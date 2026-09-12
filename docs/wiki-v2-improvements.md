# Evidence retrieval and bounded maintenance

## Optional evidence retrieval

`wiki.answer_packet` accepts `retrievalMode: "legacy" | "evidence"` with a
`query`. Omission preserves legacy behavior, including path-only packets. The
option does not enable inference, configure a provider or grant document access.
Use `includeSemantic: false` for a deterministic lexical-only query.

Evidence mode combines existing lexical and admitted semantic ranks with
equal-weight reciprocal rank fusion (`k=60`, at most 20 candidates per channel).
Repeated hits within a channel do not add votes. An unavailable semantic backend
leaves lexical results. Exact phrases, exclusions and structured filters retain
the existing strict engine and do not expand through semantic or graph results.

Current source revisions, authority, moderation and original evidence are checked
after candidate selection. One-hop explicit relations and incoming contradictions
are navigation, not proof. Existing shared-source ancestry groups remain advisory;
multiple summaries of one work are not independent confirmation. An exact
semantic source anchor can supply a passage when translated/paraphrased query
terms do not occur literally. A rank never certifies that a passage answers a
question.

Evidence packets drop display metadata before complete source units and prioritize
counterpoints and original sources over leads. Omitted counterpoints produce a
specific gap and revision-guarded continuation. The complete serialized response
still fits `maxChars`; callers must follow `partial` and gap signals rather than
interpret a short packet as complete knowledge.

The default remains legacy unless the fixed bilingual/mixed evaluation meets
the approved quality gates at equal response budgets. Character counts are not
model tokens, lexical fixtures are not real-inference quality measurements, and
local I/O is not measured NAS traffic.

## Maintenance delivery

The second implementation package is tracked separately in the execution record.
No autonomous maintenance, content migration, new provider or NAS protection is
enabled by deploying the retrieval package.
