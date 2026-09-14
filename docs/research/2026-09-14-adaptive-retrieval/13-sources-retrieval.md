---
id: adaptive-retrieval-13-sources-retrieval
kind: research-proposal
description: Primary sources for filtering, statecharts, graphs and feedback.
keywords: [retrieval, statechart, scale, context, 검색]
use_when: Evaluating primary sources for filtering, statecharts, graphs and feedback.
skip_when: Seeking an approved runtime contract or measured production capacity.
position: 13 of 14; see parent for navigation.
parent: README.md
previous: 12-sequence.md
next: 14-sources-agents.md
status: proposed-not-implemented
---
# Retrieval and graph sources

Reviewed2026-09-14. Results are workload-specific; recommendations in this report are separate.
[S1] Patel, Kraft, Guestrin, Zaharia. ACORN. SIGMOD2024; inspected arXiv v1(March7,2024).
[Paper](https://arxiv.org/html/2403.04871v1).
Predicate-aware ANN and filter-vector correlation; no local integration or copied speedup claim.
[S2] LanceDB. Metadata Filtering; current docs plus installed Node0.38.0 declarations.
[Documentation](https://docs.lancedb.com/search/filtering).
Default prefilter and scalar indexes motivate plan inspection, not proof of a live ANN index.
query.d.ts documents postfilter/bypassVectorIndex/explainPlan; table.d.ts documents createIndex.
[S3] Microsoft Research. DiskANN project; reviewed2026-09-14.
[Project](https://www.microsoft.com/en-us/research/project/project-akupara-approximate-nearest-neighbor-search-for-large-scale-semantic-search/).
SSD-backed, fresh and filtered retrieval; do not transfer SSD measurements to SMB.
[S4] W3C. State Chart XML: State Machine Notation for Control Abstraction. Recommendation2015.
[Specification](https://www.w3.org/TR/scxml/).
Hierarchical/orthogonal states; using the concept does not require installing XML machinery.
[S5] Jeong et al. Adaptive-RAG: Learning to Adapt Retrieval-Augmented Large Language Models through Question Complexity.
[NAACL2024 paper](https://aclanthology.org/2024.naacl-long.389/).
Adaptive no/single/multiple retrieval; open-domain QA does not validate enterprise authorization.
[S6] Jimenez Gutierrez et al. From RAG to Memory: Non-Parametric Continual Learning for Large Language Models.
[HippoRAG2, ICML2025, arXiv v2](https://arxiv.org/html/2502.14802v2).
Passage-aware PPR and online triple filtering; whole-corpus LLM extraction is not adopted.
[S7] Joachims, Swaminathan, Schnabel. Unbiased Learning-to-Rank with Biased Feedback. WSDM2017.
[Paper](https://arxiv.org/abs/1608.04468).
Position/exposure bias; explicit relevance marks still need task-specific validation.
[S13] Edge, Trinh, Larson. LazyGraphRAG. Microsoft Research, November25,2024; June6,2025 editor note.
[Research report](https://www.microsoft.com/en-us/research/blog/lazygraphrag-setting-a-new-standard-for-quality-and-cost/).
Deferred summarization and budgeted relevance tests; study uses5,590news articles and100synthetic queries.
Not a million-document, MCPVault or ACL evaluation. No deployment/product adoption is implied.
