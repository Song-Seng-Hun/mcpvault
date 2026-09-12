# Offline MOC / Leiden evaluation — 2026-09-12

This is a small, deliberately cross-linked synthetic diagnostic, not a general
retrieval or summarization benchmark. Production grouping remains explicit MOC.

Fixture: `tests/fixtures/topic-clustering.json`, SHA256
`e9ae39d2d8f0ccb9cb29d00796c135cce3eaea22c2f8d513ddac58e602582f88`.
All observations and source labels below are fictional fixture premises.

Host-only execution used Python3.10.9, igraph1.0.0, leidenalg0.12.0 and
texttable1.7.0 in a Git-excluded isolated evaluation environment. Official PyPI
Windows wheel SHA256 values were pinned before installation:

| Package | SHA256 |
| --- | --- |
| leidenalg0.12.0 | f5d9529b44d5f6add0847d68fa6ced99f581357f6ca02b54c049eb3a2f45ff04 |
| igraph1.0.0 | faeff8ede0cf15eb4ded44b0fcea6e1886740146e60504c24ad2da14e0939563 |
| texttable1.7.0 | 72227d592c82b3d7f672731ae73e4d1f88cd8e2ef5b075a7a7f01a23a3743917 |

`scripts/evaluate_topic_clustering.py` runs weighted modularity with seed42,
until convergence. Three repeated partitions matched. Partition-only times were
0.307,0.141,0.122ms; these exclude interpreter/import/fixture construction and are
not whole-build performance or peak RAM measurements. The fixture has11 raw
typed/directed relations; the separate unsigned undirected projection has10
weighted pairs. Projection weights are grouping affinity, never confidence or
truth. Every raw relation is preserved in the local report.

At both4000 and12000 input-character budgets:

| Method | Packed chars | Selected | Claims with source labels | Conditions | Open questions | Counterargument pairs in same group |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| MOC |1270|8/8|6/6|6/6|2/2|2/2|
| Leiden |1274|8/8|6/6|6/6|2/2|0/2|

MOC groups were Cache[c1–c4] and Retry[r1–r4]. Leiden grouped similar example
roles: [c1,r1], [c2,r2], [c3,r3], [c4,r4]. Cross-group argument links remain
available; separated pairs do **not** prove a downstream agent omitted dissent.

## Current-agent comparison

Same current task agent, same eight premises and same question: “When do these
techniques help, what contradicts them, and what remains unresolved?” Both
conditions used the same1000-character output ceiling. This is an unblinded
single-agent paired inspection; it is not an independently replicated model
trial. The exact model build was not independently attested. No separate model
API/CLI invocation was made; authoring this inspection uses ordinary task tokens.

MOC-conditioned summary:

> Cache: stable inputs avoid repeated work[c1]; missing invalidation after mutation
> creates stale results, opposing that benefit[c2→c1]. An enforced entry cap bounds
> retention[c3]. Skewed-workload benefit remains unresolved[c4]. Retry: idempotent
> transient operations recover[r1], but absent idempotency keys can
> duplicate side effects[r2→r1]. A cap enforced across callers bounds attempts[r3].
> Coordinated overload amplification remains unresolved[r4]. These are fixture
> observations, not universal recommendations.

Leiden-conditioned summary:

> Benefits[c1,r1]: stable-input caching avoids repeat work; idempotent retries
> recover transient failures. Failures[c2,r2]: missing invalidation yields stale
> cache results[c2→c1], and missing idempotency protection duplicates retry side
> effects[r2→r1]. Bounds[c3,r3]: enforced entry caps limit retention; a retry cap
> enforced across callers limits attempts. Open questions[c4,r4]: skewed workloads
> may change cache benefit; coordinated retries may amplify overload. All claims
> remain limited to the cited synthetic observations.

Manual criterion check: both summaries retain6/6 source-addressable claims,
6/6 conditions,2/2 explicit counterargument pairs and2/2 unresolved questions.
Reading all groups allowed the agent to preserve cross-group dissent. Neither
summary was published to the Wiki. This small check does not establish a quality
advantage for either grouping; larger blind repeated trials would be needed.

## Reproduction and scope

Run the three stdlib tests with the isolated interpreter:
`python scripts/test_topic_clustering.py`, then
`python scripts/evaluate_topic_clustering.py`. The latter only reads the fixed
repository fixture and writes a Git-excluded derived evaluation report, never
the NAS Vault. Runtime dependencies are not added to the server or global Python.

The design uses existing authored graphs, as described by
[GraphRAG BYOG](https://microsoft.github.io/graphrag/index/byog/), without installing
a GraphRAG server. Leiden execution follows the
[official package interface](https://leidenalg.readthedocs.io/en/stable/intro.html).
