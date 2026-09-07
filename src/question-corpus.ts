export type CorpusLanguage = 'ko' | 'en' | 'mixed';

export interface CorpusNote {
  path: string;
  content: string;
}

export interface CorpusQuestion {
  id: string;
  language: CorpusLanguage;
  category: string;
  query: string;
  expectedPaths: string[];
  expectedEvidence: Record<string, string[]>;
}

export interface AnswerPacket {
  sources?: readonly ({ path: string; passages?: readonly { text: string }[] } | string)[];
  candidates?: readonly ({ path: string } | string)[];
  passages?: readonly { text: string }[];
}

export interface BaselineMetrics {
  recallAt5: number;
  mrr: number;
}

export interface PacketEvaluation {
  rankings: string[][];
  recallAt5: number;
  mrr: number;
  evidenceCoverage: number;
  resultChars: number;
  latencyMs: number[];
  bodyReads: number;
}

/** Measured before answer_packet existed; do not replace with post-change values. */
export const fixedLexicalBaseline: BaselineMetrics = {
  recallAt5: 0.9212962962962963,
  mrr: 0.8402777777777778,
};

export const corpusNotes: CorpusNote[] = [
  { path: 'Knowledge/Search.md', content: '# 검색\n\n어휘 검색은 Markdown 본문과 제한된 메타데이터를 대상으로 한다. 검색 결과는 최대 5개와 bounded excerpt를 반환한다.' },
  { path: 'Knowledge/Vector.md', content: '---\naliases: [벡터 검색, semantic retrieval]\n---\n# 벡터 검색\n\n의미 검색은 선택적 보조 경로이며 lexical 결과와 구분된다.' },
  { path: 'Knowledge/Vector-Old.md', content: '---\nlifecycle: retired\n---\n# Retired Vector Plan\n\n퇴역한 벡터 계획은 더 이상 현재 권위 있는 사실이 아니다.' },
  { path: 'Knowledge/Cache.md', content: '---\nretrieval_cues: [stale cache, 오래된 캐시]\nuse_when: 캐시 불일치와 freshness를 점검할 때\n---\n# 캐시 일관성\n\nstale cache는 원본 Markdown을 다시 읽어 확인한다.' },
  { path: 'Knowledge/Cache-Policy.md', content: '# 캐시 정책\n\n캐시는 정답의 근거가 아니다. 현재 revision과 원문을 검증해야 한다.' },
  { path: 'Knowledge/Negation.md', content: '# 부정 조건\n\n검색은 semantic-only가 아니며 숨은 노트를 노출하지 않는다. 캐시를 무조건 신뢰하지 않는다.' },
  { path: 'Knowledge/Conditions.md', content: '# 사용 조건\n\n네트워크가 없을 때에는 lexical 검색을 사용한다. semantic 검색은 조건부로만 추가한다.' },
  { path: 'Knowledge/LongNote.md', content: '# 긴 노트\n\n서론은 검색 테스트에 관한 일반적인 배경이다.\n\n' + '중간 설명이 반복된다. '.repeat(40) + '\n\n## 늦은 결론\n\nlate passage evidence: bounded retrieval remains authoritative.' },
  { path: 'Knowledge/MultiSection.md', content: '# 다중 섹션\n\n## 설치\n\n설치 섹션은 Node와 npm을 사용한다.\n\n## 운영\n\n운영 섹션은 revision과 재시작을 확인한다.\n\n## 장애 대응\n\n장애 대응은 원본 note를 다시 읽는다.' },
  { path: 'Knowledge/Counterexample.md', content: '# 반례\n\n반례: semantic 점수가 높아도 현재 Markdown에 없는 사실을 만들 수 없다.' },
  { path: 'Knowledge/Deploy.md', content: '# 배포\n\n배포 전에는 build와 targeted test를 실행하지만 publish는 하지 않는다.' },
  { path: 'Knowledge/Database.md', content: '# Database Index\n\nThe database index is a disposable read model over Markdown.' },
  { path: 'Knowledge/Graph.md', content: '# Graph Neighborhood\n\nGraph links are navigation, not evidence or permission.' },
  { path: 'Community/Noise.md', content: '# Community chatter\n\nThis noisy community post mentions vector search, cache, and database without being canonical knowledge.' },
  { path: 'Community/Question.md', content: '# Community question\n\nA community discussion asks whether lexical search can find aliases.' },
  { path: 'Knowledge/English.md', content: '# Lexical Search\n\nLexical search is authoritative for exact evidence and bounded excerpts.' },
  { path: 'Knowledge/Authority.md', content: '# Authority Relations\n\nExplicit same_as and close_match relations are controlled discovery hints.' },
  { path: 'Knowledge/Security.md', content: '# Security\n\nHidden candidates and private content must not leak through ambiguity details.' },
  { path: 'Knowledge/Revision.md', content: '# Revision Safety\n\nMutation requires expectedRevision and a re-read of the same target.' },
  { path: 'Knowledge/Missing.md', content: '# Missing Knowledge\n\nThis note documents that an absent answer must remain absent.' },
];

const q = (id: string, language: CorpusLanguage, category: string, query: string, expectedPaths: string[], expectedEvidence: Record<string, string[]> = {}): CorpusQuestion => ({
  id,
  language,
  category,
  query,
  expectedPaths: [...expectedPaths].sort(),
  expectedEvidence: Object.fromEntries(expectedPaths.map(path => [path, expectedEvidence[path] || [path.replace(/^.*\//, '').replace(/\.md$/, '')]])),
});

export const corpusQuestions: CorpusQuestion[] = [
  q('q-ko-01', 'ko', 'alias', '벡터 검색', ['Knowledge/Vector.md'], { 'Knowledge/Vector.md': ['의미 검색'] }),
  q('q-ko-02', 'ko', 'ambiguity', '캐시', ['Knowledge/Cache-Policy.md', 'Knowledge/Cache.md', 'Community/Noise.md'], { 'Knowledge/Cache-Policy.md': ['정답의 근거'], 'Knowledge/Cache.md': ['stale cache'], 'Community/Noise.md': ['noisy community post'] }),
  q('q-ko-03', 'ko', 'negation', 'semantic-only -숨은', ['Knowledge/Negation.md'], { 'Knowledge/Negation.md': ['숨은 노트를 노출하지 않는다'] }),
  q('q-ko-04', 'ko', 'condition', '네트워크 없을 때 lexical', ['Knowledge/Conditions.md'], { 'Knowledge/Conditions.md': ['네트워크가 없을 때'] }),
  q('q-ko-05', 'ko', 'late-passage', 'late passage evidence', ['Knowledge/LongNote.md'], { 'Knowledge/LongNote.md': ['late passage evidence'] }),
  q('q-ko-06', 'ko', 'multi-section', '운영 revision 재시작', ['Knowledge/MultiSection.md'], { 'Knowledge/MultiSection.md': ['운영 섹션'] }),
  q('q-ko-07', 'ko', 'missing-knowledge', '양자 암호화 레시피', []),
  q('q-ko-08', 'ko', 'retired-fact', '퇴역 벡터 계획', ['Knowledge/Vector-Old.md'], { 'Knowledge/Vector-Old.md': ['현재 권위 있는 사실이 아니다'] }),
  q('q-ko-09', 'ko', 'counterexample', '반례 semantic 점수', ['Knowledge/Counterexample.md'], { 'Knowledge/Counterexample.md': ['현재 Markdown에 없는 사실'] }),
  q('q-ko-10', 'ko', 'communitynoise', 'community vector cache', ['Community/Noise.md'], { 'Community/Noise.md': ['noisy community post'] }),
  q('q-ko-11', 'ko', 'alias', 'semantic retrieval', ['Knowledge/Vector.md'], { 'Knowledge/Vector.md': ['의미 검색'] }),
  q('q-ko-12', 'ko', 'negation', '캐시 무조건 신뢰하지 않는다', ['Knowledge/Negation.md'], { 'Knowledge/Negation.md': ['무조건 신뢰하지 않는다'] }),
  q('q-ko-13', 'ko', 'condition', 'semantic 조건부 추가', ['Knowledge/Conditions.md'], { 'Knowledge/Conditions.md': ['조건부로만 추가'] }),
  q('q-ko-14', 'ko', 'multi-section', '장애 대응 원본 note', ['Knowledge/MultiSection.md'], { 'Knowledge/MultiSection.md': ['장애 대응은 원본 note'] }),
  q('q-ko-15', 'ko', 'evidence', '검색 결과 bounded excerpt', ['Knowledge/Search.md'], { 'Knowledge/Search.md': ['bounded excerpt'] }),
  q('q-ko-16', 'ko', 'security', '숨은 후보 노출 금지', ['Knowledge/Security.md'], { 'Knowledge/Security.md': ['Hidden candidates'] }),
  q('q-ko-17', 'ko', 'revision', 'expectedRevision 재읽기', ['Knowledge/Revision.md'], { 'Knowledge/Revision.md': ['expectedRevision'] }),
  q('q-ko-18', 'ko', 'missing-knowledge', '화성의 현재 날씨', []),
  q('q-ko-19', 'ko', 'counterexample', '반례 사실 만들 수 없다', ['Knowledge/Counterexample.md'], { 'Knowledge/Counterexample.md': ['사실을 만들 수 없다'] }),
  q('q-ko-20', 'ko', 'communitynoise', '커뮤니티 토론 alias', ['Community/Question.md'], { 'Community/Question.md': ['community discussion'] }),
  q('q-en-01', 'en', 'alias', 'vector search', ['Knowledge/Vector.md', 'Community/Noise.md'], { 'Knowledge/Vector.md': ['선택적 보조 경로'], 'Community/Noise.md': ['noisy community post'] }),
  q('q-en-02', 'en', 'ambiguity', 'search cache', ['Knowledge/Cache-Policy.md', 'Knowledge/Cache.md', 'Community/Noise.md'], { 'Knowledge/Cache-Policy.md': ['정답의 근거'], 'Knowledge/Cache.md': ['stale cache'], 'Community/Noise.md': ['noisy community post'] }),
  q('q-en-03', 'en', 'negation', 'not permission', ['Knowledge/Graph.md'], { 'Knowledge/Graph.md': ['not evidence or permission'] }),
  q('q-en-04', 'en', 'condition', 'network lexical', ['Knowledge/Conditions.md'], { 'Knowledge/Conditions.md': ['lexical 검색'] }),
  q('q-en-05', 'en', 'late-passage', 'late passage evidence', ['Knowledge/LongNote.md'], { 'Knowledge/LongNote.md': ['late passage evidence'] }),
  q('q-en-06', 'en', 'multi-section', 'install Node npm', ['Knowledge/MultiSection.md'], { 'Knowledge/MultiSection.md': ['Node와 npm'] }),
  q('q-en-07', 'en', 'missing-knowledge', 'quantum recipe missing', []),
  q('q-en-08', 'en', 'retired-fact', 'retired vector plan', ['Knowledge/Vector-Old.md'], { 'Knowledge/Vector-Old.md': ['퇴역한 벡터 계획'] }),
  q('q-en-09', 'en', 'counterexample', 'semantic score fabricate facts', ['Knowledge/Counterexample.md'], { 'Knowledge/Counterexample.md': ['semantic 점수가 높아도'] }),
  q('q-en-10', 'en', 'communitynoise', 'noisy community post', ['Community/Noise.md'], { 'Community/Noise.md': ['noisy community post'] }),
  q('q-mixed-01', 'mixed', 'alias', '벡터 search alias', ['Knowledge/Vector.md'], { 'Knowledge/Vector.md': ['의미 검색'] }),
  q('q-mixed-02', 'mixed', 'ambiguity', 'cache 캐시', ['Knowledge/Cache-Policy.md', 'Knowledge/Cache.md', 'Community/Noise.md'], { 'Knowledge/Cache-Policy.md': ['정답의 근거'], 'Knowledge/Cache.md': ['stale cache'], 'Community/Noise.md': ['noisy community post'] }),
  q('q-mixed-03', 'mixed', 'negation', 'semantic 아니고 lexical', ['Knowledge/Negation.md', 'Knowledge/Conditions.md'], { 'Knowledge/Negation.md': ['semantic-only가 아니며'], 'Knowledge/Conditions.md': ['lexical 검색'] }),
  q('q-mixed-04', 'mixed', 'condition', 'freshness 점검 when', ['Knowledge/Cache.md'], { 'Knowledge/Cache.md': ['원본 Markdown을 다시 읽어'] }),
  q('q-mixed-05', 'mixed', 'late-passage', 'bounded retrieval authoritative', ['Knowledge/LongNote.md'], { 'Knowledge/LongNote.md': ['bounded retrieval remains authoritative'] }),
  q('q-mixed-06', 'mixed', 'multi-section', '운영 section revision', ['Knowledge/MultiSection.md'], { 'Knowledge/MultiSection.md': ['revision과 재시작'] }),
  q('q-mixed-07', 'mixed', 'missing-knowledge', '없는 knowledge: teleportation', []),
  q('q-mixed-08', 'mixed', 'retired-fact', 'retired 계획 current fact', ['Knowledge/Vector-Old.md'], { 'Knowledge/Vector-Old.md': ['현재 권위 있는 사실'] }),
  q('q-mixed-09', 'mixed', 'counterexample', 'counterexample Markdown 사실', ['Knowledge/Counterexample.md'], { 'Knowledge/Counterexample.md': ['현재 Markdown'] }),
  q('q-mixed-10', 'mixed', 'communitynoise', 'community alias discussion', ['Community/Question.md'], { 'Community/Question.md': ['community discussion'] }),
];

export function recallAt5(questions: readonly CorpusQuestion[], rankings: readonly (readonly string[])[]): number {
  const pairs = questions.map((question, index) => ({ question, ranking: rankings[index] || [] })).filter(pair => pair.question.expectedPaths.length > 0);
  if (pairs.length === 0) return 0;
  return pairs.reduce((sum, { question, ranking }) => sum + question.expectedPaths.filter(path => ranking.slice(0, 5).includes(path)).length / question.expectedPaths.length, 0) / pairs.length;
}

export function meanReciprocalRank(questions: readonly CorpusQuestion[], rankings: readonly (readonly string[])[]): number {
  const pairs = questions.map((question, index) => ({ question, ranking: rankings[index] || [] })).filter(pair => pair.question.expectedPaths.length > 0);
  if (pairs.length === 0) return 0;
  return pairs.reduce((sum, { question, ranking }) => {
    const rank = ranking.findIndex(path => question.expectedPaths.includes(path));
    return sum + (rank < 0 ? 0 : 1 / (rank + 1));
  }, 0) / pairs.length;
}

function packetPath(value: { path: string } | string): string {
  return typeof value === 'string' ? value : value.path;
}

export function answerPacketRanking(packet: AnswerPacket): string[] {
  return [...(packet.sources || []), ...(packet.candidates || [])]
    .map(packetPath)
    .filter(Boolean)
    .filter((path, index, paths) => paths.indexOf(path) === index)
    .slice(0, 5);
}

export function evaluateAnswerPackets(questions: readonly CorpusQuestion[], packets: readonly AnswerPacket[], timings: readonly number[] = [], bodyReads = 0): PacketEvaluation {
  const rankings = packets.map(answerPacketRanking);
  const answerable = questions.filter(question => question.expectedPaths.length > 0);
  const answerableRankings = rankings.filter((_ranking, index) => questions[index]!.expectedPaths.length > 0);
  let evidenceTotal = 0;
  let evidenceFound = 0;
  for (let index = 0; index < questions.length; index += 1) {
    const question = questions[index]!;
    const evidence = Object.values(question.expectedEvidence).flat();
    const packet = packets[index];
    evidenceTotal += evidence.length;
    for (const [path, fragments] of Object.entries(question.expectedEvidence)) {
      const source = (packet?.sources || []).find(candidate => typeof candidate !== 'string' && candidate.path === path);
      const text = source && typeof source !== 'string' ? (source.passages || []).map(passage => passage.text).join('\n') : '';
      evidenceFound += fragments.filter(fragment => text.includes(fragment)).length;
    }
  }
  return {
    rankings,
    recallAt5: recallAt5(answerable, answerableRankings),
    mrr: meanReciprocalRank(answerable, answerableRankings),
    evidenceCoverage: evidenceTotal === 0 ? 0 : evidenceFound / evidenceTotal,
    resultChars: packets.reduce((sum, packet) => sum + JSON.stringify(packet).length, 0),
    latencyMs: [...timings],
    bodyReads,
  };
}

export function hasNoMetricRegression(metrics: Pick<PacketEvaluation, 'recallAt5' | 'mrr'>, baseline = fixedLexicalBaseline): boolean {
  return metrics.recallAt5 >= baseline.recallAt5 && metrics.mrr >= baseline.mrr;
}
