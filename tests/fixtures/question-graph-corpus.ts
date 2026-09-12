/**
 * Fixed, authored GraphRAG P1 evaluation, independent of the frozen80 corpus.
 * Frozen before retrieval runs: never adjust gold from observed scores.
 * Source integrity hashes cover bodies; locator revisions cover full UTF-8 notes.
 * Only query strings reach wiki.answer_packet; gold and pins are scoring data.
 * Four 24-leaf hubs plus return cycles exceed the metadata/relation windows.
 */
import type { CorpusNote } from './question-corpus.js';
import type { EvidenceQuestion } from './question-evidence-corpus.js';

interface GraphLocatorPin { from: string; path: string; revision: string; heading: string }
const graphData: { notes: CorpusNote[]; questions: EvidenceQuestion[]; pins: GraphLocatorPin[] } = {
  "notes": [
    {
      "path": "_sources/GraphEvaluation/original.md",
      "content": "---\nllm_wiki_type: source\nimmutable: true\nsource_work_id: graph-evaluation-original\ncontent_sha256: 9f153152b0edf2faf99b16799bd1b1dfd2f078dec242ca21c8e814f8c22d4475\n---\n# Admission\n\n## Finding\n\nA witnessed lease must be acquired before activation.\n"
    },
    {
      "path": "_sources/GraphEvaluation/outgoing.md",
      "content": "---\nllm_wiki_type: source\nimmutable: true\nsource_work_id: graph-evaluation-outgoing\ncontent_sha256: 9039cc3ee80d8052a5348b3b97774ee8c94b13562eebe09abe9825a01e5cd85a\n---\n# Exception\n\n## Finding\n\nA saturated queue increases tail latency.\n"
    },
    {
      "path": "_sources/GraphEvaluation/incoming.md",
      "content": "---\nllm_wiki_type: source\nimmutable: true\nsource_work_id: graph-evaluation-incoming\ncontent_sha256: c1c6482a6f18d29b956941505121d17d7338c5faddf994ff905e513fa6c85f17\ncontradicts: [Knowledge/GraphEvaluation/incoming-bridge.md]\n---\n# Observation\n\n## Finding\n\nA stale replica can return an earlier value.\n"
    },
    {
      "path": "_sources/GraphEvaluation/shared.md",
      "content": "---\nllm_wiki_type: source\nimmutable: true\nsource_work_id: graph-evaluation-shared\ncontent_sha256: 87d14959a5f76b80b67be24a3967f367e54d324dbc820a845d2d2a6c13845934\n---\n# Record\n\n## Finding\n\nThe archive keeps exactly one signed receipt.\n"
    },
    {
      "path": "_sources/GraphEvaluation/hub.md",
      "content": "---\nllm_wiki_type: source\nimmutable: true\nsource_work_id: graph-evaluation-hub\ncontent_sha256: d2c39a004b190eeda5c143dfa4c7d006f96ca7b1c70c6566ad7de03db5cfbb0b\n---\n# Boundary\n\n## Finding\n\nA release requires a verified rollback snapshot.\n"
    },
    {
      "path": "Knowledge/GraphEvaluation/entry.md",
      "content": "---\nllm_wiki_type: knowledge\nnote_kind: atomic\naliases: [lanternhandoff, 등불인계]\nsupports: [\"[[Amber bridge]]\"]\n---\n# amberdispatch\n\namberdispatch entry coordinates a witnessed transition.\n"
    },
    {
      "path": "Knowledge/GraphEvaluation/bridge.md",
      "content": "---\nllm_wiki_type: knowledge\nnote_kind: atomic\naliases: [Amber bridge, 호박다리]\nevidence:\n  - path: _sources/GraphEvaluation/original.md\n    revision: ea59043d0e98378a1ced6e17be685ce67affc70305b81870cf94909bb43891f6\n    heading: Finding\n---\n# Bridge\n\nThe admission requirement is recorded in an original.\n"
    },
    {
      "path": "Knowledge/GraphEvaluation/alias-entry.md",
      "content": "---\nllm_wiki_type: knowledge\nnote_kind: atomic\naliases: [jadehandoff]\nderived_from: [\"[[호박다리]]\"]\n---\n# 청옥인계\n\n청옥인계 절차는 연결된 조건을 확인한다.\n"
    },
    {
      "path": "Knowledge/GraphEvaluation/outgoing-entry.md",
      "content": "---\nllm_wiki_type: knowledge\nnote_kind: atomic\nsupports: [Knowledge/GraphEvaluation/outgoing-bridge.md]\n---\n# copperwindow\n\ncopperwindow entry asks about load.\n"
    },
    {
      "path": "Knowledge/GraphEvaluation/outgoing-bridge.md",
      "content": "---\nllm_wiki_type: knowledge\nnote_kind: atomic\ncontradicts: [_sources/GraphEvaluation/outgoing.md]\n---\n# Load claim\n\nThe claimed reduction has an authored exception.\n"
    },
    {
      "path": "Knowledge/GraphEvaluation/incoming-entry.md",
      "content": "---\nllm_wiki_type: knowledge\nnote_kind: atomic\ndepends_on: [Knowledge/GraphEvaluation/incoming-bridge.md]\n---\n# silvertide\n\nsilvertide entry asks about freshness.\n"
    },
    {
      "path": "Knowledge/GraphEvaluation/incoming-bridge.md",
      "content": "---\nllm_wiki_type: knowledge\nnote_kind: atomic\n---\n# Freshness claim\n\nThe claim is subject to an incoming observation.\n"
    },
    {
      "path": "Knowledge/GraphEvaluation/incoming-decoy.md",
      "content": "---\nllm_wiki_type: knowledge\nnote_kind: atomic\nsupports: [Knowledge/GraphEvaluation/incoming-bridge.md]\n---\n# Irrelevant appendix\n\nThis appendix grants unconditional freshness.\n"
    },
    {
      "path": "Knowledge/GraphEvaluation/shared-entry.md",
      "content": "---\nllm_wiki_type: knowledge\nnote_kind: atomic\ndepends_on: [Knowledge/GraphEvaluation/shared-left.md, Knowledge/GraphEvaluation/shared-right.md]\n---\n# twinarchive\n\ntwinarchive entry combines two summaries.\n"
    },
    {
      "path": "Knowledge/GraphEvaluation/shared-left.md",
      "content": "---\nllm_wiki_type: knowledge\nnote_kind: atomic\nevidence:\n  - path: _sources/GraphEvaluation/shared.md\n    revision: 0a1f54b9c1b80c2a338a940359b616767b3b9859e980b42ca78ace9eccdf725b\n    heading: Finding\n---\n# First summary\n\nOne account describes the receipt.\n"
    },
    {
      "path": "Knowledge/GraphEvaluation/shared-right.md",
      "content": "---\nllm_wiki_type: knowledge\nnote_kind: atomic\nderived_from: [_sources/GraphEvaluation/shared.md]\nevidence:\n  - path: _sources/GraphEvaluation/shared.md\n    revision: 0a1f54b9c1b80c2a338a940359b616767b3b9859e980b42ca78ace9eccdf725b\n    heading: Finding\n---\n# Second summary\n\nAnother account refers to the same receipt.\n"
    },
    {
      "path": "Knowledge/GraphEvaluation/hub-entry.md",
      "content": "---\nllm_wiki_type: knowledge\nnote_kind: atomic\nsupports: [Knowledge/GraphEvaluation/hub-entry.md, Knowledge/GraphEvaluation/hub-0.md, Knowledge/GraphEvaluation/hub-1.md, Knowledge/GraphEvaluation/hub-2.md, Knowledge/GraphEvaluation/hub-3.md]\n---\n# orbitjunction\n\norbitjunction entry checks the release boundary.\n"
    },
    {
      "path": "Knowledge/GraphEvaluation/hub-0.md",
      "content": "---\nllm_wiki_type: knowledge\nnote_kind: atomic\nevidence:\n  - path: _sources/GraphEvaluation/hub.md\n    revision: 44b596669cb528987887ab5d8fc8b758555b9c3d7415d6101ece0a23079d3935\n    heading: Finding\nsupports: [Knowledge/GraphEvaluation/hub-entry.md, Knowledge/GraphEvaluation/leaf-0-00.md, Knowledge/GraphEvaluation/leaf-0-01.md, Knowledge/GraphEvaluation/leaf-0-02.md, Knowledge/GraphEvaluation/leaf-0-03.md, Knowledge/GraphEvaluation/leaf-0-04.md, Knowledge/GraphEvaluation/leaf-0-05.md, Knowledge/GraphEvaluation/leaf-0-06.md, Knowledge/GraphEvaluation/leaf-0-07.md, Knowledge/GraphEvaluation/leaf-0-08.md, Knowledge/GraphEvaluation/leaf-0-09.md, Knowledge/GraphEvaluation/leaf-0-10.md, Knowledge/GraphEvaluation/leaf-0-11.md, Knowledge/GraphEvaluation/leaf-0-12.md, Knowledge/GraphEvaluation/leaf-0-13.md, Knowledge/GraphEvaluation/leaf-0-14.md, Knowledge/GraphEvaluation/leaf-0-15.md, Knowledge/GraphEvaluation/leaf-0-16.md, Knowledge/GraphEvaluation/leaf-0-17.md, Knowledge/GraphEvaluation/leaf-0-18.md, Knowledge/GraphEvaluation/leaf-0-19.md, Knowledge/GraphEvaluation/leaf-0-20.md, Knowledge/GraphEvaluation/leaf-0-21.md, Knowledge/GraphEvaluation/leaf-0-22.md, Knowledge/GraphEvaluation/leaf-0-23.md]\n---\n# Junction 0\n\nA bounded neighborhood includes a return cycle.\n"
    },
    {
      "path": "Knowledge/GraphEvaluation/leaf-0-00.md",
      "content": "---\nllm_wiki_type: knowledge\nnote_kind: atomic\nsupports: [Knowledge/GraphEvaluation/hub-0.md]\n---\n# Appendix\n\nSupplementary background does not establish the admission condition.\n"
    },
    {
      "path": "Knowledge/GraphEvaluation/leaf-0-01.md",
      "content": "---\nllm_wiki_type: knowledge\nnote_kind: atomic\nsupports: [Knowledge/GraphEvaluation/hub-0.md]\n---\n# Appendix\n\nSupplementary background does not establish the admission condition.\n"
    },
    {
      "path": "Knowledge/GraphEvaluation/leaf-0-02.md",
      "content": "---\nllm_wiki_type: knowledge\nnote_kind: atomic\nsupports: [Knowledge/GraphEvaluation/hub-0.md]\n---\n# Appendix\n\nSupplementary background does not establish the admission condition.\n"
    },
    {
      "path": "Knowledge/GraphEvaluation/leaf-0-03.md",
      "content": "---\nllm_wiki_type: knowledge\nnote_kind: atomic\nsupports: [Knowledge/GraphEvaluation/hub-0.md]\n---\n# Appendix\n\nSupplementary background does not establish the admission condition.\n"
    },
    {
      "path": "Knowledge/GraphEvaluation/leaf-0-04.md",
      "content": "---\nllm_wiki_type: knowledge\nnote_kind: atomic\nsupports: [Knowledge/GraphEvaluation/hub-0.md]\n---\n# Appendix\n\nSupplementary background does not establish the admission condition.\n"
    },
    {
      "path": "Knowledge/GraphEvaluation/leaf-0-05.md",
      "content": "---\nllm_wiki_type: knowledge\nnote_kind: atomic\nsupports: [Knowledge/GraphEvaluation/hub-0.md]\n---\n# Appendix\n\nSupplementary background does not establish the admission condition.\n"
    },
    {
      "path": "Knowledge/GraphEvaluation/leaf-0-06.md",
      "content": "---\nllm_wiki_type: knowledge\nnote_kind: atomic\nsupports: [Knowledge/GraphEvaluation/hub-0.md]\n---\n# Appendix\n\nSupplementary background does not establish the admission condition.\n"
    },
    {
      "path": "Knowledge/GraphEvaluation/leaf-0-07.md",
      "content": "---\nllm_wiki_type: knowledge\nnote_kind: atomic\nsupports: [Knowledge/GraphEvaluation/hub-0.md]\n---\n# Appendix\n\nSupplementary background does not establish the admission condition.\n"
    },
    {
      "path": "Knowledge/GraphEvaluation/leaf-0-08.md",
      "content": "---\nllm_wiki_type: knowledge\nnote_kind: atomic\nsupports: [Knowledge/GraphEvaluation/hub-0.md]\n---\n# Appendix\n\nSupplementary background does not establish the admission condition.\n"
    },
    {
      "path": "Knowledge/GraphEvaluation/leaf-0-09.md",
      "content": "---\nllm_wiki_type: knowledge\nnote_kind: atomic\nsupports: [Knowledge/GraphEvaluation/hub-0.md]\n---\n# Appendix\n\nSupplementary background does not establish the admission condition.\n"
    },
    {
      "path": "Knowledge/GraphEvaluation/leaf-0-10.md",
      "content": "---\nllm_wiki_type: knowledge\nnote_kind: atomic\nsupports: [Knowledge/GraphEvaluation/hub-0.md]\n---\n# Appendix\n\nSupplementary background does not establish the admission condition.\n"
    },
    {
      "path": "Knowledge/GraphEvaluation/leaf-0-11.md",
      "content": "---\nllm_wiki_type: knowledge\nnote_kind: atomic\nsupports: [Knowledge/GraphEvaluation/hub-0.md]\n---\n# Appendix\n\nSupplementary background does not establish the admission condition.\n"
    },
    {
      "path": "Knowledge/GraphEvaluation/leaf-0-12.md",
      "content": "---\nllm_wiki_type: knowledge\nnote_kind: atomic\nsupports: [Knowledge/GraphEvaluation/hub-0.md]\n---\n# Appendix\n\nSupplementary background does not establish the admission condition.\n"
    },
    {
      "path": "Knowledge/GraphEvaluation/leaf-0-13.md",
      "content": "---\nllm_wiki_type: knowledge\nnote_kind: atomic\nsupports: [Knowledge/GraphEvaluation/hub-0.md]\n---\n# Appendix\n\nSupplementary background does not establish the admission condition.\n"
    },
    {
      "path": "Knowledge/GraphEvaluation/leaf-0-14.md",
      "content": "---\nllm_wiki_type: knowledge\nnote_kind: atomic\nsupports: [Knowledge/GraphEvaluation/hub-0.md]\n---\n# Appendix\n\nSupplementary background does not establish the admission condition.\n"
    },
    {
      "path": "Knowledge/GraphEvaluation/leaf-0-15.md",
      "content": "---\nllm_wiki_type: knowledge\nnote_kind: atomic\nsupports: [Knowledge/GraphEvaluation/hub-0.md]\n---\n# Appendix\n\nSupplementary background does not establish the admission condition.\n"
    },
    {
      "path": "Knowledge/GraphEvaluation/leaf-0-16.md",
      "content": "---\nllm_wiki_type: knowledge\nnote_kind: atomic\nsupports: [Knowledge/GraphEvaluation/hub-0.md]\n---\n# Appendix\n\nSupplementary background does not establish the admission condition.\n"
    },
    {
      "path": "Knowledge/GraphEvaluation/leaf-0-17.md",
      "content": "---\nllm_wiki_type: knowledge\nnote_kind: atomic\nsupports: [Knowledge/GraphEvaluation/hub-0.md]\n---\n# Appendix\n\nSupplementary background does not establish the admission condition.\n"
    },
    {
      "path": "Knowledge/GraphEvaluation/leaf-0-18.md",
      "content": "---\nllm_wiki_type: knowledge\nnote_kind: atomic\nsupports: [Knowledge/GraphEvaluation/hub-0.md]\n---\n# Appendix\n\nSupplementary background does not establish the admission condition.\n"
    },
    {
      "path": "Knowledge/GraphEvaluation/leaf-0-19.md",
      "content": "---\nllm_wiki_type: knowledge\nnote_kind: atomic\nsupports: [Knowledge/GraphEvaluation/hub-0.md]\n---\n# Appendix\n\nSupplementary background does not establish the admission condition.\n"
    },
    {
      "path": "Knowledge/GraphEvaluation/leaf-0-20.md",
      "content": "---\nllm_wiki_type: knowledge\nnote_kind: atomic\nsupports: [Knowledge/GraphEvaluation/hub-0.md]\n---\n# Appendix\n\nSupplementary background does not establish the admission condition.\n"
    },
    {
      "path": "Knowledge/GraphEvaluation/leaf-0-21.md",
      "content": "---\nllm_wiki_type: knowledge\nnote_kind: atomic\nsupports: [Knowledge/GraphEvaluation/hub-0.md]\n---\n# Appendix\n\nSupplementary background does not establish the admission condition.\n"
    },
    {
      "path": "Knowledge/GraphEvaluation/leaf-0-22.md",
      "content": "---\nllm_wiki_type: knowledge\nnote_kind: atomic\nsupports: [Knowledge/GraphEvaluation/hub-0.md]\n---\n# Appendix\n\nSupplementary background does not establish the admission condition.\n"
    },
    {
      "path": "Knowledge/GraphEvaluation/leaf-0-23.md",
      "content": "---\nllm_wiki_type: knowledge\nnote_kind: atomic\nsupports: [Knowledge/GraphEvaluation/hub-0.md]\n---\n# Appendix\n\nSupplementary background does not establish the admission condition.\n"
    },
    {
      "path": "Knowledge/GraphEvaluation/hub-1.md",
      "content": "---\nllm_wiki_type: knowledge\nnote_kind: atomic\nsupports: [Knowledge/GraphEvaluation/hub-entry.md, Knowledge/GraphEvaluation/leaf-1-00.md, Knowledge/GraphEvaluation/leaf-1-01.md, Knowledge/GraphEvaluation/leaf-1-02.md, Knowledge/GraphEvaluation/leaf-1-03.md, Knowledge/GraphEvaluation/leaf-1-04.md, Knowledge/GraphEvaluation/leaf-1-05.md, Knowledge/GraphEvaluation/leaf-1-06.md, Knowledge/GraphEvaluation/leaf-1-07.md, Knowledge/GraphEvaluation/leaf-1-08.md, Knowledge/GraphEvaluation/leaf-1-09.md, Knowledge/GraphEvaluation/leaf-1-10.md, Knowledge/GraphEvaluation/leaf-1-11.md, Knowledge/GraphEvaluation/leaf-1-12.md, Knowledge/GraphEvaluation/leaf-1-13.md, Knowledge/GraphEvaluation/leaf-1-14.md, Knowledge/GraphEvaluation/leaf-1-15.md, Knowledge/GraphEvaluation/leaf-1-16.md, Knowledge/GraphEvaluation/leaf-1-17.md, Knowledge/GraphEvaluation/leaf-1-18.md, Knowledge/GraphEvaluation/leaf-1-19.md, Knowledge/GraphEvaluation/leaf-1-20.md, Knowledge/GraphEvaluation/leaf-1-21.md, Knowledge/GraphEvaluation/leaf-1-22.md, Knowledge/GraphEvaluation/leaf-1-23.md]\n---\n# Junction 1\n\nA bounded neighborhood includes a return cycle.\n"
    },
    {
      "path": "Knowledge/GraphEvaluation/leaf-1-00.md",
      "content": "---\nllm_wiki_type: knowledge\nnote_kind: atomic\nsupports: [Knowledge/GraphEvaluation/hub-1.md]\n---\n# Appendix\n\nSupplementary background does not establish the admission condition.\n"
    },
    {
      "path": "Knowledge/GraphEvaluation/leaf-1-01.md",
      "content": "---\nllm_wiki_type: knowledge\nnote_kind: atomic\nsupports: [Knowledge/GraphEvaluation/hub-1.md]\n---\n# Appendix\n\nSupplementary background does not establish the admission condition.\n"
    },
    {
      "path": "Knowledge/GraphEvaluation/leaf-1-02.md",
      "content": "---\nllm_wiki_type: knowledge\nnote_kind: atomic\nsupports: [Knowledge/GraphEvaluation/hub-1.md]\n---\n# Appendix\n\nSupplementary background does not establish the admission condition.\n"
    },
    {
      "path": "Knowledge/GraphEvaluation/leaf-1-03.md",
      "content": "---\nllm_wiki_type: knowledge\nnote_kind: atomic\nsupports: [Knowledge/GraphEvaluation/hub-1.md]\n---\n# Appendix\n\nSupplementary background does not establish the admission condition.\n"
    },
    {
      "path": "Knowledge/GraphEvaluation/leaf-1-04.md",
      "content": "---\nllm_wiki_type: knowledge\nnote_kind: atomic\nsupports: [Knowledge/GraphEvaluation/hub-1.md]\n---\n# Appendix\n\nSupplementary background does not establish the admission condition.\n"
    },
    {
      "path": "Knowledge/GraphEvaluation/leaf-1-05.md",
      "content": "---\nllm_wiki_type: knowledge\nnote_kind: atomic\nsupports: [Knowledge/GraphEvaluation/hub-1.md]\n---\n# Appendix\n\nSupplementary background does not establish the admission condition.\n"
    },
    {
      "path": "Knowledge/GraphEvaluation/leaf-1-06.md",
      "content": "---\nllm_wiki_type: knowledge\nnote_kind: atomic\nsupports: [Knowledge/GraphEvaluation/hub-1.md]\n---\n# Appendix\n\nSupplementary background does not establish the admission condition.\n"
    },
    {
      "path": "Knowledge/GraphEvaluation/leaf-1-07.md",
      "content": "---\nllm_wiki_type: knowledge\nnote_kind: atomic\nsupports: [Knowledge/GraphEvaluation/hub-1.md]\n---\n# Appendix\n\nSupplementary background does not establish the admission condition.\n"
    },
    {
      "path": "Knowledge/GraphEvaluation/leaf-1-08.md",
      "content": "---\nllm_wiki_type: knowledge\nnote_kind: atomic\nsupports: [Knowledge/GraphEvaluation/hub-1.md]\n---\n# Appendix\n\nSupplementary background does not establish the admission condition.\n"
    },
    {
      "path": "Knowledge/GraphEvaluation/leaf-1-09.md",
      "content": "---\nllm_wiki_type: knowledge\nnote_kind: atomic\nsupports: [Knowledge/GraphEvaluation/hub-1.md]\n---\n# Appendix\n\nSupplementary background does not establish the admission condition.\n"
    },
    {
      "path": "Knowledge/GraphEvaluation/leaf-1-10.md",
      "content": "---\nllm_wiki_type: knowledge\nnote_kind: atomic\nsupports: [Knowledge/GraphEvaluation/hub-1.md]\n---\n# Appendix\n\nSupplementary background does not establish the admission condition.\n"
    },
    {
      "path": "Knowledge/GraphEvaluation/leaf-1-11.md",
      "content": "---\nllm_wiki_type: knowledge\nnote_kind: atomic\nsupports: [Knowledge/GraphEvaluation/hub-1.md]\n---\n# Appendix\n\nSupplementary background does not establish the admission condition.\n"
    },
    {
      "path": "Knowledge/GraphEvaluation/leaf-1-12.md",
      "content": "---\nllm_wiki_type: knowledge\nnote_kind: atomic\nsupports: [Knowledge/GraphEvaluation/hub-1.md]\n---\n# Appendix\n\nSupplementary background does not establish the admission condition.\n"
    },
    {
      "path": "Knowledge/GraphEvaluation/leaf-1-13.md",
      "content": "---\nllm_wiki_type: knowledge\nnote_kind: atomic\nsupports: [Knowledge/GraphEvaluation/hub-1.md]\n---\n# Appendix\n\nSupplementary background does not establish the admission condition.\n"
    },
    {
      "path": "Knowledge/GraphEvaluation/leaf-1-14.md",
      "content": "---\nllm_wiki_type: knowledge\nnote_kind: atomic\nsupports: [Knowledge/GraphEvaluation/hub-1.md]\n---\n# Appendix\n\nSupplementary background does not establish the admission condition.\n"
    },
    {
      "path": "Knowledge/GraphEvaluation/leaf-1-15.md",
      "content": "---\nllm_wiki_type: knowledge\nnote_kind: atomic\nsupports: [Knowledge/GraphEvaluation/hub-1.md]\n---\n# Appendix\n\nSupplementary background does not establish the admission condition.\n"
    },
    {
      "path": "Knowledge/GraphEvaluation/leaf-1-16.md",
      "content": "---\nllm_wiki_type: knowledge\nnote_kind: atomic\nsupports: [Knowledge/GraphEvaluation/hub-1.md]\n---\n# Appendix\n\nSupplementary background does not establish the admission condition.\n"
    },
    {
      "path": "Knowledge/GraphEvaluation/leaf-1-17.md",
      "content": "---\nllm_wiki_type: knowledge\nnote_kind: atomic\nsupports: [Knowledge/GraphEvaluation/hub-1.md]\n---\n# Appendix\n\nSupplementary background does not establish the admission condition.\n"
    },
    {
      "path": "Knowledge/GraphEvaluation/leaf-1-18.md",
      "content": "---\nllm_wiki_type: knowledge\nnote_kind: atomic\nsupports: [Knowledge/GraphEvaluation/hub-1.md]\n---\n# Appendix\n\nSupplementary background does not establish the admission condition.\n"
    },
    {
      "path": "Knowledge/GraphEvaluation/leaf-1-19.md",
      "content": "---\nllm_wiki_type: knowledge\nnote_kind: atomic\nsupports: [Knowledge/GraphEvaluation/hub-1.md]\n---\n# Appendix\n\nSupplementary background does not establish the admission condition.\n"
    },
    {
      "path": "Knowledge/GraphEvaluation/leaf-1-20.md",
      "content": "---\nllm_wiki_type: knowledge\nnote_kind: atomic\nsupports: [Knowledge/GraphEvaluation/hub-1.md]\n---\n# Appendix\n\nSupplementary background does not establish the admission condition.\n"
    },
    {
      "path": "Knowledge/GraphEvaluation/leaf-1-21.md",
      "content": "---\nllm_wiki_type: knowledge\nnote_kind: atomic\nsupports: [Knowledge/GraphEvaluation/hub-1.md]\n---\n# Appendix\n\nSupplementary background does not establish the admission condition.\n"
    },
    {
      "path": "Knowledge/GraphEvaluation/leaf-1-22.md",
      "content": "---\nllm_wiki_type: knowledge\nnote_kind: atomic\nsupports: [Knowledge/GraphEvaluation/hub-1.md]\n---\n# Appendix\n\nSupplementary background does not establish the admission condition.\n"
    },
    {
      "path": "Knowledge/GraphEvaluation/leaf-1-23.md",
      "content": "---\nllm_wiki_type: knowledge\nnote_kind: atomic\nsupports: [Knowledge/GraphEvaluation/hub-1.md]\n---\n# Appendix\n\nSupplementary background does not establish the admission condition.\n"
    },
    {
      "path": "Knowledge/GraphEvaluation/hub-2.md",
      "content": "---\nllm_wiki_type: knowledge\nnote_kind: atomic\nsupports: [Knowledge/GraphEvaluation/hub-entry.md, Knowledge/GraphEvaluation/leaf-2-00.md, Knowledge/GraphEvaluation/leaf-2-01.md, Knowledge/GraphEvaluation/leaf-2-02.md, Knowledge/GraphEvaluation/leaf-2-03.md, Knowledge/GraphEvaluation/leaf-2-04.md, Knowledge/GraphEvaluation/leaf-2-05.md, Knowledge/GraphEvaluation/leaf-2-06.md, Knowledge/GraphEvaluation/leaf-2-07.md, Knowledge/GraphEvaluation/leaf-2-08.md, Knowledge/GraphEvaluation/leaf-2-09.md, Knowledge/GraphEvaluation/leaf-2-10.md, Knowledge/GraphEvaluation/leaf-2-11.md, Knowledge/GraphEvaluation/leaf-2-12.md, Knowledge/GraphEvaluation/leaf-2-13.md, Knowledge/GraphEvaluation/leaf-2-14.md, Knowledge/GraphEvaluation/leaf-2-15.md, Knowledge/GraphEvaluation/leaf-2-16.md, Knowledge/GraphEvaluation/leaf-2-17.md, Knowledge/GraphEvaluation/leaf-2-18.md, Knowledge/GraphEvaluation/leaf-2-19.md, Knowledge/GraphEvaluation/leaf-2-20.md, Knowledge/GraphEvaluation/leaf-2-21.md, Knowledge/GraphEvaluation/leaf-2-22.md, Knowledge/GraphEvaluation/leaf-2-23.md]\n---\n# Junction 2\n\nA bounded neighborhood includes a return cycle.\n"
    },
    {
      "path": "Knowledge/GraphEvaluation/leaf-2-00.md",
      "content": "---\nllm_wiki_type: knowledge\nnote_kind: atomic\nsupports: [Knowledge/GraphEvaluation/hub-2.md]\n---\n# Appendix\n\nSupplementary background does not establish the admission condition.\n"
    },
    {
      "path": "Knowledge/GraphEvaluation/leaf-2-01.md",
      "content": "---\nllm_wiki_type: knowledge\nnote_kind: atomic\nsupports: [Knowledge/GraphEvaluation/hub-2.md]\n---\n# Appendix\n\nSupplementary background does not establish the admission condition.\n"
    },
    {
      "path": "Knowledge/GraphEvaluation/leaf-2-02.md",
      "content": "---\nllm_wiki_type: knowledge\nnote_kind: atomic\nsupports: [Knowledge/GraphEvaluation/hub-2.md]\n---\n# Appendix\n\nSupplementary background does not establish the admission condition.\n"
    },
    {
      "path": "Knowledge/GraphEvaluation/leaf-2-03.md",
      "content": "---\nllm_wiki_type: knowledge\nnote_kind: atomic\nsupports: [Knowledge/GraphEvaluation/hub-2.md]\n---\n# Appendix\n\nSupplementary background does not establish the admission condition.\n"
    },
    {
      "path": "Knowledge/GraphEvaluation/leaf-2-04.md",
      "content": "---\nllm_wiki_type: knowledge\nnote_kind: atomic\nsupports: [Knowledge/GraphEvaluation/hub-2.md]\n---\n# Appendix\n\nSupplementary background does not establish the admission condition.\n"
    },
    {
      "path": "Knowledge/GraphEvaluation/leaf-2-05.md",
      "content": "---\nllm_wiki_type: knowledge\nnote_kind: atomic\nsupports: [Knowledge/GraphEvaluation/hub-2.md]\n---\n# Appendix\n\nSupplementary background does not establish the admission condition.\n"
    },
    {
      "path": "Knowledge/GraphEvaluation/leaf-2-06.md",
      "content": "---\nllm_wiki_type: knowledge\nnote_kind: atomic\nsupports: [Knowledge/GraphEvaluation/hub-2.md]\n---\n# Appendix\n\nSupplementary background does not establish the admission condition.\n"
    },
    {
      "path": "Knowledge/GraphEvaluation/leaf-2-07.md",
      "content": "---\nllm_wiki_type: knowledge\nnote_kind: atomic\nsupports: [Knowledge/GraphEvaluation/hub-2.md]\n---\n# Appendix\n\nSupplementary background does not establish the admission condition.\n"
    },
    {
      "path": "Knowledge/GraphEvaluation/leaf-2-08.md",
      "content": "---\nllm_wiki_type: knowledge\nnote_kind: atomic\nsupports: [Knowledge/GraphEvaluation/hub-2.md]\n---\n# Appendix\n\nSupplementary background does not establish the admission condition.\n"
    },
    {
      "path": "Knowledge/GraphEvaluation/leaf-2-09.md",
      "content": "---\nllm_wiki_type: knowledge\nnote_kind: atomic\nsupports: [Knowledge/GraphEvaluation/hub-2.md]\n---\n# Appendix\n\nSupplementary background does not establish the admission condition.\n"
    },
    {
      "path": "Knowledge/GraphEvaluation/leaf-2-10.md",
      "content": "---\nllm_wiki_type: knowledge\nnote_kind: atomic\nsupports: [Knowledge/GraphEvaluation/hub-2.md]\n---\n# Appendix\n\nSupplementary background does not establish the admission condition.\n"
    },
    {
      "path": "Knowledge/GraphEvaluation/leaf-2-11.md",
      "content": "---\nllm_wiki_type: knowledge\nnote_kind: atomic\nsupports: [Knowledge/GraphEvaluation/hub-2.md]\n---\n# Appendix\n\nSupplementary background does not establish the admission condition.\n"
    },
    {
      "path": "Knowledge/GraphEvaluation/leaf-2-12.md",
      "content": "---\nllm_wiki_type: knowledge\nnote_kind: atomic\nsupports: [Knowledge/GraphEvaluation/hub-2.md]\n---\n# Appendix\n\nSupplementary background does not establish the admission condition.\n"
    },
    {
      "path": "Knowledge/GraphEvaluation/leaf-2-13.md",
      "content": "---\nllm_wiki_type: knowledge\nnote_kind: atomic\nsupports: [Knowledge/GraphEvaluation/hub-2.md]\n---\n# Appendix\n\nSupplementary background does not establish the admission condition.\n"
    },
    {
      "path": "Knowledge/GraphEvaluation/leaf-2-14.md",
      "content": "---\nllm_wiki_type: knowledge\nnote_kind: atomic\nsupports: [Knowledge/GraphEvaluation/hub-2.md]\n---\n# Appendix\n\nSupplementary background does not establish the admission condition.\n"
    },
    {
      "path": "Knowledge/GraphEvaluation/leaf-2-15.md",
      "content": "---\nllm_wiki_type: knowledge\nnote_kind: atomic\nsupports: [Knowledge/GraphEvaluation/hub-2.md]\n---\n# Appendix\n\nSupplementary background does not establish the admission condition.\n"
    },
    {
      "path": "Knowledge/GraphEvaluation/leaf-2-16.md",
      "content": "---\nllm_wiki_type: knowledge\nnote_kind: atomic\nsupports: [Knowledge/GraphEvaluation/hub-2.md]\n---\n# Appendix\n\nSupplementary background does not establish the admission condition.\n"
    },
    {
      "path": "Knowledge/GraphEvaluation/leaf-2-17.md",
      "content": "---\nllm_wiki_type: knowledge\nnote_kind: atomic\nsupports: [Knowledge/GraphEvaluation/hub-2.md]\n---\n# Appendix\n\nSupplementary background does not establish the admission condition.\n"
    },
    {
      "path": "Knowledge/GraphEvaluation/leaf-2-18.md",
      "content": "---\nllm_wiki_type: knowledge\nnote_kind: atomic\nsupports: [Knowledge/GraphEvaluation/hub-2.md]\n---\n# Appendix\n\nSupplementary background does not establish the admission condition.\n"
    },
    {
      "path": "Knowledge/GraphEvaluation/leaf-2-19.md",
      "content": "---\nllm_wiki_type: knowledge\nnote_kind: atomic\nsupports: [Knowledge/GraphEvaluation/hub-2.md]\n---\n# Appendix\n\nSupplementary background does not establish the admission condition.\n"
    },
    {
      "path": "Knowledge/GraphEvaluation/leaf-2-20.md",
      "content": "---\nllm_wiki_type: knowledge\nnote_kind: atomic\nsupports: [Knowledge/GraphEvaluation/hub-2.md]\n---\n# Appendix\n\nSupplementary background does not establish the admission condition.\n"
    },
    {
      "path": "Knowledge/GraphEvaluation/leaf-2-21.md",
      "content": "---\nllm_wiki_type: knowledge\nnote_kind: atomic\nsupports: [Knowledge/GraphEvaluation/hub-2.md]\n---\n# Appendix\n\nSupplementary background does not establish the admission condition.\n"
    },
    {
      "path": "Knowledge/GraphEvaluation/leaf-2-22.md",
      "content": "---\nllm_wiki_type: knowledge\nnote_kind: atomic\nsupports: [Knowledge/GraphEvaluation/hub-2.md]\n---\n# Appendix\n\nSupplementary background does not establish the admission condition.\n"
    },
    {
      "path": "Knowledge/GraphEvaluation/leaf-2-23.md",
      "content": "---\nllm_wiki_type: knowledge\nnote_kind: atomic\nsupports: [Knowledge/GraphEvaluation/hub-2.md]\n---\n# Appendix\n\nSupplementary background does not establish the admission condition.\n"
    },
    {
      "path": "Knowledge/GraphEvaluation/hub-3.md",
      "content": "---\nllm_wiki_type: knowledge\nnote_kind: atomic\nsupports: [Knowledge/GraphEvaluation/hub-entry.md, Knowledge/GraphEvaluation/leaf-3-00.md, Knowledge/GraphEvaluation/leaf-3-01.md, Knowledge/GraphEvaluation/leaf-3-02.md, Knowledge/GraphEvaluation/leaf-3-03.md, Knowledge/GraphEvaluation/leaf-3-04.md, Knowledge/GraphEvaluation/leaf-3-05.md, Knowledge/GraphEvaluation/leaf-3-06.md, Knowledge/GraphEvaluation/leaf-3-07.md, Knowledge/GraphEvaluation/leaf-3-08.md, Knowledge/GraphEvaluation/leaf-3-09.md, Knowledge/GraphEvaluation/leaf-3-10.md, Knowledge/GraphEvaluation/leaf-3-11.md, Knowledge/GraphEvaluation/leaf-3-12.md, Knowledge/GraphEvaluation/leaf-3-13.md, Knowledge/GraphEvaluation/leaf-3-14.md, Knowledge/GraphEvaluation/leaf-3-15.md, Knowledge/GraphEvaluation/leaf-3-16.md, Knowledge/GraphEvaluation/leaf-3-17.md, Knowledge/GraphEvaluation/leaf-3-18.md, Knowledge/GraphEvaluation/leaf-3-19.md, Knowledge/GraphEvaluation/leaf-3-20.md, Knowledge/GraphEvaluation/leaf-3-21.md, Knowledge/GraphEvaluation/leaf-3-22.md, Knowledge/GraphEvaluation/leaf-3-23.md]\n---\n# Junction 3\n\nA bounded neighborhood includes a return cycle.\n"
    },
    {
      "path": "Knowledge/GraphEvaluation/leaf-3-00.md",
      "content": "---\nllm_wiki_type: knowledge\nnote_kind: atomic\nsupports: [Knowledge/GraphEvaluation/hub-3.md]\n---\n# Appendix\n\nSupplementary background does not establish the admission condition.\n"
    },
    {
      "path": "Knowledge/GraphEvaluation/leaf-3-01.md",
      "content": "---\nllm_wiki_type: knowledge\nnote_kind: atomic\nsupports: [Knowledge/GraphEvaluation/hub-3.md]\n---\n# Appendix\n\nSupplementary background does not establish the admission condition.\n"
    },
    {
      "path": "Knowledge/GraphEvaluation/leaf-3-02.md",
      "content": "---\nllm_wiki_type: knowledge\nnote_kind: atomic\nsupports: [Knowledge/GraphEvaluation/hub-3.md]\n---\n# Appendix\n\nSupplementary background does not establish the admission condition.\n"
    },
    {
      "path": "Knowledge/GraphEvaluation/leaf-3-03.md",
      "content": "---\nllm_wiki_type: knowledge\nnote_kind: atomic\nsupports: [Knowledge/GraphEvaluation/hub-3.md]\n---\n# Appendix\n\nSupplementary background does not establish the admission condition.\n"
    },
    {
      "path": "Knowledge/GraphEvaluation/leaf-3-04.md",
      "content": "---\nllm_wiki_type: knowledge\nnote_kind: atomic\nsupports: [Knowledge/GraphEvaluation/hub-3.md]\n---\n# Appendix\n\nSupplementary background does not establish the admission condition.\n"
    },
    {
      "path": "Knowledge/GraphEvaluation/leaf-3-05.md",
      "content": "---\nllm_wiki_type: knowledge\nnote_kind: atomic\nsupports: [Knowledge/GraphEvaluation/hub-3.md]\n---\n# Appendix\n\nSupplementary background does not establish the admission condition.\n"
    },
    {
      "path": "Knowledge/GraphEvaluation/leaf-3-06.md",
      "content": "---\nllm_wiki_type: knowledge\nnote_kind: atomic\nsupports: [Knowledge/GraphEvaluation/hub-3.md]\n---\n# Appendix\n\nSupplementary background does not establish the admission condition.\n"
    },
    {
      "path": "Knowledge/GraphEvaluation/leaf-3-07.md",
      "content": "---\nllm_wiki_type: knowledge\nnote_kind: atomic\nsupports: [Knowledge/GraphEvaluation/hub-3.md]\n---\n# Appendix\n\nSupplementary background does not establish the admission condition.\n"
    },
    {
      "path": "Knowledge/GraphEvaluation/leaf-3-08.md",
      "content": "---\nllm_wiki_type: knowledge\nnote_kind: atomic\nsupports: [Knowledge/GraphEvaluation/hub-3.md]\n---\n# Appendix\n\nSupplementary background does not establish the admission condition.\n"
    },
    {
      "path": "Knowledge/GraphEvaluation/leaf-3-09.md",
      "content": "---\nllm_wiki_type: knowledge\nnote_kind: atomic\nsupports: [Knowledge/GraphEvaluation/hub-3.md]\n---\n# Appendix\n\nSupplementary background does not establish the admission condition.\n"
    },
    {
      "path": "Knowledge/GraphEvaluation/leaf-3-10.md",
      "content": "---\nllm_wiki_type: knowledge\nnote_kind: atomic\nsupports: [Knowledge/GraphEvaluation/hub-3.md]\n---\n# Appendix\n\nSupplementary background does not establish the admission condition.\n"
    },
    {
      "path": "Knowledge/GraphEvaluation/leaf-3-11.md",
      "content": "---\nllm_wiki_type: knowledge\nnote_kind: atomic\nsupports: [Knowledge/GraphEvaluation/hub-3.md]\n---\n# Appendix\n\nSupplementary background does not establish the admission condition.\n"
    },
    {
      "path": "Knowledge/GraphEvaluation/leaf-3-12.md",
      "content": "---\nllm_wiki_type: knowledge\nnote_kind: atomic\nsupports: [Knowledge/GraphEvaluation/hub-3.md]\n---\n# Appendix\n\nSupplementary background does not establish the admission condition.\n"
    },
    {
      "path": "Knowledge/GraphEvaluation/leaf-3-13.md",
      "content": "---\nllm_wiki_type: knowledge\nnote_kind: atomic\nsupports: [Knowledge/GraphEvaluation/hub-3.md]\n---\n# Appendix\n\nSupplementary background does not establish the admission condition.\n"
    },
    {
      "path": "Knowledge/GraphEvaluation/leaf-3-14.md",
      "content": "---\nllm_wiki_type: knowledge\nnote_kind: atomic\nsupports: [Knowledge/GraphEvaluation/hub-3.md]\n---\n# Appendix\n\nSupplementary background does not establish the admission condition.\n"
    },
    {
      "path": "Knowledge/GraphEvaluation/leaf-3-15.md",
      "content": "---\nllm_wiki_type: knowledge\nnote_kind: atomic\nsupports: [Knowledge/GraphEvaluation/hub-3.md]\n---\n# Appendix\n\nSupplementary background does not establish the admission condition.\n"
    },
    {
      "path": "Knowledge/GraphEvaluation/leaf-3-16.md",
      "content": "---\nllm_wiki_type: knowledge\nnote_kind: atomic\nsupports: [Knowledge/GraphEvaluation/hub-3.md]\n---\n# Appendix\n\nSupplementary background does not establish the admission condition.\n"
    },
    {
      "path": "Knowledge/GraphEvaluation/leaf-3-17.md",
      "content": "---\nllm_wiki_type: knowledge\nnote_kind: atomic\nsupports: [Knowledge/GraphEvaluation/hub-3.md]\n---\n# Appendix\n\nSupplementary background does not establish the admission condition.\n"
    },
    {
      "path": "Knowledge/GraphEvaluation/leaf-3-18.md",
      "content": "---\nllm_wiki_type: knowledge\nnote_kind: atomic\nsupports: [Knowledge/GraphEvaluation/hub-3.md]\n---\n# Appendix\n\nSupplementary background does not establish the admission condition.\n"
    },
    {
      "path": "Knowledge/GraphEvaluation/leaf-3-19.md",
      "content": "---\nllm_wiki_type: knowledge\nnote_kind: atomic\nsupports: [Knowledge/GraphEvaluation/hub-3.md]\n---\n# Appendix\n\nSupplementary background does not establish the admission condition.\n"
    },
    {
      "path": "Knowledge/GraphEvaluation/leaf-3-20.md",
      "content": "---\nllm_wiki_type: knowledge\nnote_kind: atomic\nsupports: [Knowledge/GraphEvaluation/hub-3.md]\n---\n# Appendix\n\nSupplementary background does not establish the admission condition.\n"
    },
    {
      "path": "Knowledge/GraphEvaluation/leaf-3-21.md",
      "content": "---\nllm_wiki_type: knowledge\nnote_kind: atomic\nsupports: [Knowledge/GraphEvaluation/hub-3.md]\n---\n# Appendix\n\nSupplementary background does not establish the admission condition.\n"
    },
    {
      "path": "Knowledge/GraphEvaluation/leaf-3-22.md",
      "content": "---\nllm_wiki_type: knowledge\nnote_kind: atomic\nsupports: [Knowledge/GraphEvaluation/hub-3.md]\n---\n# Appendix\n\nSupplementary background does not establish the admission condition.\n"
    },
    {
      "path": "Knowledge/GraphEvaluation/leaf-3-23.md",
      "content": "---\nllm_wiki_type: knowledge\nnote_kind: atomic\nsupports: [Knowledge/GraphEvaluation/hub-3.md]\n---\n# Appendix\n\nSupplementary background does not establish the admission condition.\n"
    }
  ],
  "questions": [
    {
      "id": "graph-two-hop-en",
      "language": "en",
      "category": "two-hop",
      "query": "amberdispatch",
      "expectedPaths": [
        "_sources/GraphEvaluation/original.md"
      ],
      "expectedEvidence": {
        "_sources/GraphEvaluation/original.md": [
          "A witnessed lease must be acquired before activation."
        ]
      },
      "forbiddenPaths": []
    },
    {
      "id": "graph-two-hop-ko",
      "language": "ko",
      "category": "two-hop",
      "query": "청옥인계",
      "expectedPaths": [
        "_sources/GraphEvaluation/original.md"
      ],
      "expectedEvidence": {
        "_sources/GraphEvaluation/original.md": [
          "A witnessed lease must be acquired before activation."
        ]
      },
      "forbiddenPaths": []
    },
    {
      "id": "graph-alias-en",
      "language": "en",
      "category": "alias",
      "query": "lanternhandoff",
      "expectedPaths": [
        "_sources/GraphEvaluation/original.md"
      ],
      "expectedEvidence": {
        "_sources/GraphEvaluation/original.md": [
          "A witnessed lease must be acquired before activation."
        ]
      },
      "forbiddenPaths": []
    },
    {
      "id": "graph-alias-ko",
      "language": "ko",
      "category": "alias",
      "query": "등불인계",
      "expectedPaths": [
        "_sources/GraphEvaluation/original.md"
      ],
      "expectedEvidence": {
        "_sources/GraphEvaluation/original.md": [
          "A witnessed lease must be acquired before activation."
        ]
      },
      "forbiddenPaths": []
    },
    {
      "id": "graph-alias-mixed",
      "language": "mixed",
      "category": "alias",
      "query": "등불인계 lanternhandoff",
      "expectedPaths": [
        "_sources/GraphEvaluation/original.md"
      ],
      "expectedEvidence": {
        "_sources/GraphEvaluation/original.md": [
          "A witnessed lease must be acquired before activation."
        ]
      },
      "forbiddenPaths": []
    },
    {
      "id": "graph-alias-relation",
      "language": "en",
      "category": "alias",
      "query": "jadehandoff",
      "expectedPaths": [
        "_sources/GraphEvaluation/original.md"
      ],
      "expectedEvidence": {
        "_sources/GraphEvaluation/original.md": [
          "A witnessed lease must be acquired before activation."
        ]
      },
      "forbiddenPaths": []
    },
    {
      "id": "graph-outgoing",
      "language": "en",
      "category": "contradiction",
      "query": "copperwindow",
      "expectedPaths": [
        "_sources/GraphEvaluation/outgoing.md"
      ],
      "expectedEvidence": {
        "_sources/GraphEvaluation/outgoing.md": [
          "A saturated queue increases tail latency."
        ]
      },
      "forbiddenPaths": []
    },
    {
      "id": "graph-reverse",
      "language": "en",
      "category": "contradiction",
      "query": "silvertide",
      "expectedPaths": [
        "_sources/GraphEvaluation/incoming.md"
      ],
      "expectedEvidence": {
        "_sources/GraphEvaluation/incoming.md": [
          "A stale replica can return an earlier value."
        ]
      },
      "forbiddenPaths": [
        "Knowledge/GraphEvaluation/incoming-decoy.md"
      ]
    },
    {
      "id": "graph-shared",
      "language": "en",
      "category": "shared-source",
      "query": "twinarchive",
      "expectedPaths": [
        "_sources/GraphEvaluation/shared.md"
      ],
      "expectedEvidence": {
        "_sources/GraphEvaluation/shared.md": [
          "The archive keeps exactly one signed receipt."
        ]
      },
      "forbiddenPaths": []
    },
    {
      "id": "graph-hub",
      "language": "en",
      "category": "cycle-hub",
      "query": "orbitjunction",
      "expectedPaths": [
        "_sources/GraphEvaluation/hub.md"
      ],
      "expectedEvidence": {
        "_sources/GraphEvaluation/hub.md": [
          "A release requires a verified rollback snapshot."
        ]
      },
      "forbiddenPaths": []
    },
    {
      "id": "graph-strict-phrase",
      "language": "en",
      "category": "strict",
      "query": "\"amberdispatch\"",
      "expectedPaths": [
        "Knowledge/GraphEvaluation/entry.md"
      ],
      "expectedEvidence": {
        "Knowledge/GraphEvaluation/entry.md": [
          "amberdispatch entry coordinates a witnessed transition."
        ]
      },
      "forbiddenPaths": [
        "Knowledge/GraphEvaluation/bridge.md",
        "_sources/GraphEvaluation/original.md"
      ]
    },
    {
      "id": "graph-strict-filter",
      "language": "en",
      "category": "strict",
      "query": "path:Knowledge/GraphEvaluation/ amberdispatch",
      "expectedPaths": [
        "Knowledge/GraphEvaluation/entry.md"
      ],
      "expectedEvidence": {
        "Knowledge/GraphEvaluation/entry.md": [
          "amberdispatch entry coordinates a witnessed transition."
        ]
      },
      "forbiddenPaths": [
        "Knowledge/GraphEvaluation/bridge.md",
        "_sources/GraphEvaluation/original.md"
      ]
    },
    {
      "id": "graph-strict-exclusion",
      "language": "en",
      "category": "strict",
      "query": "amberdispatch -obsoletetoken",
      "expectedPaths": [
        "Knowledge/GraphEvaluation/entry.md"
      ],
      "expectedEvidence": {
        "Knowledge/GraphEvaluation/entry.md": [
          "amberdispatch entry coordinates a witnessed transition."
        ]
      },
      "forbiddenPaths": [
        "Knowledge/GraphEvaluation/bridge.md",
        "_sources/GraphEvaluation/original.md"
      ]
    },
    {
      "id": "graph-none-en",
      "language": "en",
      "category": "noanswer",
      "query": "quasarmarmalade nebulartram",
      "expectedPaths": [],
      "expectedEvidence": {},
      "forbiddenPaths": []
    },
    {
      "id": "graph-none-ko",
      "language": "ko",
      "category": "noanswer",
      "query": "해왕성산호양식 수성지하철",
      "expectedPaths": [],
      "expectedEvidence": {},
      "forbiddenPaths": []
    },
    {
      "id": "graph-none-mixed",
      "language": "mixed",
      "category": "noanswer",
      "query": "달나라 zeppelinpermit",
      "expectedPaths": [],
      "expectedEvidence": {},
      "forbiddenPaths": []
    }
  ],
  "pins": [
    {
      "from": "Knowledge/GraphEvaluation/bridge.md",
      "path": "_sources/GraphEvaluation/original.md",
      "revision": "ea59043d0e98378a1ced6e17be685ce67affc70305b81870cf94909bb43891f6",
      "heading": "Finding"
    },
    {
      "from": "Knowledge/GraphEvaluation/shared-left.md",
      "path": "_sources/GraphEvaluation/shared.md",
      "revision": "0a1f54b9c1b80c2a338a940359b616767b3b9859e980b42ca78ace9eccdf725b",
      "heading": "Finding"
    },
    {
      "from": "Knowledge/GraphEvaluation/shared-right.md",
      "path": "_sources/GraphEvaluation/shared.md",
      "revision": "0a1f54b9c1b80c2a338a940359b616767b3b9859e980b42ca78ace9eccdf725b",
      "heading": "Finding"
    },
    {
      "from": "Knowledge/GraphEvaluation/hub-0.md",
      "path": "_sources/GraphEvaluation/hub.md",
      "revision": "44b596669cb528987887ab5d8fc8b758555b9c3d7415d6101ece0a23079d3935",
      "heading": "Finding"
    }
  ]
};

export const graphNotes = graphData.notes;
export const graphQuestions = graphData.questions;
export const graphLocatorPins = graphData.pins;
// Hash JSON.stringify({ notes, questions, pins }); no retrieval-derived baseline.
export const graphCorpusSha256 = 'ea596abf5e567bdbd39e12811921cddbfdd225fd58a123c3e17d6b7a7cb01f7f';
