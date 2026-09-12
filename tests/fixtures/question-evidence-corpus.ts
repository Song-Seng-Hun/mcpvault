/** Frozen synthetic lexical evaluation data. Never tune gold to observed scores.
 * Source bodies and questions are authored together, not sampled real workloads.
 * Hash JSON.stringify({ notes: evaluationNotes, questions: evaluationQuestions }).
 * The original fixture and its first 40 questions remain untouched.
 */
import { createHash } from 'node:crypto';
import { corpusNotes, corpusQuestions, type CorpusLanguage, type CorpusNote, type CorpusQuestion } from './question-corpus.js';

export interface EvidenceQuestion extends CorpusQuestion {
  /** Explicit distractors. All returned paths are false positives for no-answer cases. */
  forbiddenPaths?: string[];
}

const sourcePath = (id: string): string => `_sources/EvaluationV2/${id}.md`;
const knowledgePath = (id: string): string => `Knowledge/EvaluationV2/${id}.md`;

function source(id: string, title: string, text: string, properties = ''): CorpusNote {
  const body = `# ${title}\n\n${text}\n`;
  const hash = createHash('sha256').update(body, 'utf8').digest('hex');
  return { path: sourcePath(id), content: `---\nllm_wiki_type: source\nimmutable: true\nsource_work_id: evaluation-v2-${id}\ncontent_sha256: ${hash}\n${properties}---\n${body}` };
}

function anchor(id: string, title: string, text: string, properties: string): CorpusNote {
  return { path: knowledgePath(id), content: `---\nllm_wiki_type: knowledge\nnote_kind: atomic\n${properties}---\n# ${title}\n\n${text}\n` };
}

export const addedEvidenceNotes: CorpusNote[] = [
  source('renewal', '세션 갱신 지침', '세션 연장은 갱신 토큰으로 수행한다. 갱신 토큰은 한 번 사용하면 폐기한다.', 'aliases: [로그인 연장, 세션 연장]\n'),
  source('retention', '보관 기한', '자료 보존 기간은 삼십 일이다. 보관 기한이 지나면 검토를 요청한다.', 'aliases: [자료 보존 기간, 보관 기간]\n'),
  source('failover', 'Standby takeover', 'Failover means standby takeover. The standby must hold the current lease before serving traffic.', 'aliases: [failover, standby takeover]\n'),
  source('dedup', 'Duplicate suppression', 'Deduplication uses a request key. Duplicate suppression retains the first successful result.', 'aliases: [deduplication, duplicate suppression]\n'),
  source('backpressure', '역압 flow control', '역압은 backpressure라고도 부른다. A full queue pauses the producer; consumers continue draining.', 'aliases: [역압, backpressure]\n'),

  source('id-ko', '장치 식별 규칙', '장치 식별자 장치-칠호의 보정 주기는 열두 시간이다.', 'stable_id: 장치-칠호\n'),
  source('id-ko-decoy', '장치 식별 참고', '장치 식별자 장치-팔호의 보정 주기는 스물네 시간이다.', 'stable_id: 장치-팔호\n'),
  source('id-err', '오류 식별 규칙', '오류 식별자 오류-마흔둘은 서명 불일치를 뜻한다.', 'stable_id: 오류-마흔둘\n'),
  source('id-err-decoy', '다른 오류 식별 규칙', '오류 식별자 오류-마흔셋은 기한 만료를 뜻한다.', 'stable_id: 오류-마흔셋\n'),
  source('id-rfc', 'Transport identifiers', 'RFC-7319 requires a sixteen-byte nonce.', 'stable_id: RFC-7319\n'),
  source('id-rfc-decoy', 'Alternate transport identifiers', 'RFC-73190 requires a thirty-two-byte nonce.', 'stable_id: RFC-73190\n'),
  source('id-config', 'Configuration identifiers', 'cache.max_age_ms is measured in milliseconds.', 'stable_id: cache.max_age_ms\n'),
  source('id-config-decoy', 'Alternate configuration identifiers', 'cache.max_age_s is measured in seconds.', 'stable_id: cache.max_age_s\n'),
  source('id-mixed', 'SDK 오류 식별자', 'E_CONN_17은 handshake 만료를 뜻한다. Retry requires a new connection.', 'stable_id: E_CONN_17\n'),
  source('id-mixed-decoy', 'SDK 다른 오류 식별자', 'E_CONN_71은 인증 거절을 뜻한다. Retry is forbidden.', 'stable_id: E_CONN_71\n'),

  source('retry-ko', '재시도 결제 제외', '재시도는 조회 요청에만 허용한다. 결제 요청은 재시도하지 않는다.'),
  source('retry-ko-decoy', '재시도 결제 허용 초안', '재시도는 결제 요청에도 허용한다. 이 문서는 잘못된 초안이다.', 'lifecycle: retired\n'),
  source('export-ko', '내보내기 비밀 제외', '내보내기는 공개 문서만 포함한다. 비밀 문서는 내보내지 않는다.'),
  source('export-ko-decoy', '내보내기 비밀 포함 초안', '내보내기는 비밀 문서도 포함한다. 이 문서는 잘못된 초안이다.', 'lifecycle: retired\n'),
  source('offline', 'Offline writes', 'Offline clients may read snapshots. Offline clients must not submit writes.'),
  source('offline-decoy', 'Offline writes draft', 'Offline clients may submit writes without a lease. This draft is invalid.', 'lifecycle: retired\n'),
  source('tls', 'TLS exception policy', 'Certificate validation must not be disabled, even for an internal endpoint.'),
  source('tls-decoy', 'TLS exception draft', 'Certificate validation may be disabled for an internal endpoint. This draft is invalid.', 'lifecycle: retired\n'),
  source('refund', '환불 retry 조건', 'Refund retry는 idempotency key가 있을 때만 허용한다. 키가 없으면 환불을 재시도하지 않는다.'),
  source('refund-decoy', '환불 retry 초안', 'Refund retry는 idempotency key가 없어도 허용한다. 이 초안은 폐기했다.', 'lifecycle: retired\n'),

  source('batch-claim', '일괄 처리 성능 주장', '일괄 처리는 항상 지연 시간을 줄인다고 실험 가가 주장한다.', `contradicts: [${sourcePath('batch-counter')}]\n`),
  source('batch-counter', '일괄 처리 반례', '실험 나는 입력이 적으면 일괄 처리의 지연 시간이 늘어남을 관찰했다.', 'knowledge_polarity: negative\n'),
  source('compression-claim', 'Compression claim', 'Trial A claims compression reduces transfer time for every payload.', `contradicts: [${sourcePath('compression-counter')}]\n`),
  source('compression-counter', 'Compression counterexample', 'Trial B found that compressing encrypted payloads increases transfer time.', 'knowledge_polarity: negative\n'),
  source('replica-claim', 'Replica 읽기 주장', 'Replica reads are always current라는 주장이 있다.', `contradicts: [${sourcePath('replica-counter')}]\n`),
  source('replica-counter', 'Replica 읽기 반례', '비동기 replica는 복제 지연 동안 오래된 값을 반환한다.', 'knowledge_polarity: negative\n'),

  source('atlas-current', 'Atlas current schedule 현재 주기', '현재 아틀라스 점검 주기는 여섯 시간이다. The current Atlas interval is six hours. This supersedes the old daily schedule.', 'lifecycle: active\n'),
  source('atlas-retired', 'Atlas old schedule 과거 주기', '과거 아틀라스 점검 주기는 하루였다. The retired Atlas interval was twenty-four hours. This schedule is not current.', 'lifecycle: retired\nvalid_until: 2001-01-01\n'),
  anchor('atlas', '아틀라스 Atlas 주기 변경', '아틀라스 Atlas 현재 주기의 근거는 연결된 현행 원문에 있다.', `evidence_paths: [${sourcePath('atlas-current')}]\nsupersedes: [${sourcePath('atlas-retired')}]\n`),

  source('lease-rule', '원문 임대 규칙', '선출된 작성자는 유효한 임대를 확보해야 한다. 만료된 임대는 쓰기 권한을 주지 않는다.'),
  source('rotation-rule', 'Key rotation source', 'The previous verification key remains available for seven days after rotation.'),
  source('queue-rule', 'Queue prerequisite 원문', 'Queue drain 전에 producer를 중지한다. Consumers finish outstanding work before shutdown.'),
  anchor('leader', '지도자 교체 절차', '지도자 교체 절차의 선행 조건은 연결된 임대 규칙을 따른다.', `depends_on: [${sourcePath('lease-rule')}]\nevidence:\n  - path: ${sourcePath('lease-rule')}\n    startLine: 3\n    endLine: 3\n`),
  anchor('rotation', 'Signing key migration', 'Signing key migration follows the linked verification overlap rule.', `related: [${sourcePath('rotation-rule')}]\nevidence:\n  - path: ${sourcePath('rotation-rule')}\n    startLine: 3\n    endLine: 3\n`),
  anchor('queue', '종료 shutdown 순서', '종료 shutdown의 선행 조건은 연결된 queue 규칙에 있다.', `depends_on: [${sourcePath('queue-rule')}]\nevidence:\n  - path: ${sourcePath('queue-rule')}\n    startLine: 3\n    endLine: 3\n`),

  source('migration-window', '이전 작업 시간표', '자료 이전은 일요일 두 시부터 네 시까지 허용한다.'),
  source('migration-backup', '이전 작업 복구 조건', '자료 이전을 시작하기 전에 복구 가능한 백업을 검증한다.'),
  anchor('migration', '자료 이전 준비', '자료 이전의 허용 시간과 복구 조건을 함께 확인한다.', `evidence:\n  - path: ${sourcePath('migration-window')}\n    startLine: 3\n    endLine: 3\n  - path: ${sourcePath('migration-backup')}\n    startLine: 3\n    endLine: 3\n`),
  source('release-quorum', 'Release approvals', 'A release requires two independent approvals.'),
  source('release-rollback', 'Release rollback', 'A release must retain the previous artifact for rollback.'),
  anchor('release', 'Release readiness', 'Release readiness combines approval and rollback requirements.', `evidence:\n  - path: ${sourcePath('release-quorum')}\n    startLine: 3\n    endLine: 3\n  - path: ${sourcePath('release-rollback')}\n    startLine: 3\n    endLine: 3\n`),
  source('restore-order', 'Restore 복구 순서', 'Restore는 원문을 먼저 복구하고 인덱스를 나중에 재생성한다.'),
  source('restore-check', 'Restore 복구 검증', 'Restore 완료 전 원문 checksum을 백업 manifest와 비교한다.'),
  anchor('restore', 'Restore 복구 준비', 'Restore 복구 순서와 검증을 연결된 두 원문에서 확인한다.', `evidence:\n  - path: ${sourcePath('restore-order')}\n    startLine: 3\n    endLine: 3\n  - path: ${sourcePath('restore-check')}\n    startLine: 3\n    endLine: 3\n`),
];

/** Explicit source IDs resolve to fixed gold paths; fragments are literal authored text. */
function q(id: string, language: CorpusLanguage, category: string, query: string,
  gold: readonly (readonly [sourceId: string, literal: string])[], forbiddenIds: readonly string[] = []): EvidenceQuestion {
  const expectedEvidence: Record<string, string[]> = {};
  for (const [sourceId, literal] of gold) (expectedEvidence[sourcePath(sourceId)] ||= []).push(literal);
  return { id: `ev2-${id}`, language, category, query,
    expectedPaths: Object.keys(expectedEvidence).sort(), expectedEvidence,
    forbiddenPaths: forbiddenIds.map(sourcePath).sort(),
  };
}

export const addedEvidenceQuestions: EvidenceQuestion[] = [
  q('syn-ko-1', 'ko', 'synonym', '로그인 연장 뒤 갱신 토큰 처리', [['renewal', '갱신 토큰은 한 번 사용하면 폐기한다.']]),
  q('syn-ko-2', 'ko', 'synonym', '자료 보존 기간이 지나면', [['retention', '보관 기한이 지나면 검토를 요청한다.']]),
  q('syn-en-1', 'en', 'synonym', 'failover lease requirement', [['failover', 'The standby must hold the current lease before serving traffic.']]),
  q('syn-en-2', 'en', 'synonym', 'deduplication first successful result', [['dedup', 'Duplicate suppression retains the first successful result.']]),
  q('syn-mix-1', 'mixed', 'synonym', '역압 backpressure full queue', [['backpressure', 'A full queue pauses the producer; consumers continue draining.']]),

  q('id-ko-1', 'ko', 'identifier', '"장치-칠호"', [['id-ko', '장치 식별자 장치-칠호의 보정 주기는 열두 시간이다.']], ['id-ko-decoy']),
  q('id-ko-2', 'ko', 'identifier', '"오류-마흔둘"', [['id-err', '오류 식별자 오류-마흔둘은 서명 불일치를 뜻한다.']], ['id-err-decoy']),
  q('id-en-1', 'en', 'identifier', '"RFC-7319"', [['id-rfc', 'RFC-7319 requires a sixteen-byte nonce.']], ['id-rfc-decoy']),
  q('id-en-2', 'en', 'identifier', '"cache.max_age_ms"', [['id-config', 'cache.max_age_ms is measured in milliseconds.']], ['id-config-decoy']),
  q('id-mix-1', 'mixed', 'identifier', '"E_CONN_17" 오류', [['id-mixed', 'E_CONN_17은 handshake 만료를 뜻한다.']], ['id-mixed-decoy']),

  q('neg-ko-1', 'ko', 'negative-condition', '재시도 조회만 결제 제외', [['retry-ko', '재시도는 조회 요청에만 허용한다. 결제 요청은 재시도하지 않는다.']], ['retry-ko-decoy']),
  q('neg-ko-2', 'ko', 'negative-condition', '내보내기 공개만 비밀 제외', [['export-ko', '내보내기는 공개 문서만 포함한다. 비밀 문서는 내보내지 않는다.']], ['export-ko-decoy']),
  q('neg-en-1', 'en', 'negative-condition', 'offline clients must not submit writes', [['offline', 'Offline clients must not submit writes.']], ['offline-decoy']),
  q('neg-en-2', 'en', 'negative-condition', 'certificate validation must not be disabled internal endpoint', [['tls', 'Certificate validation must not be disabled, even for an internal endpoint.']], ['tls-decoy']),
  q('neg-mix-1', 'mixed', 'negative-condition', '환불 retry idempotency key 없으면', [['refund', '키가 없으면 환불을 재시도하지 않는다.']], ['refund-decoy']),

  q('contra-ko-1', 'ko', 'contradiction', '일괄 처리 지연 시간 주장과 반례', [['batch-claim', '일괄 처리는 항상 지연 시간을 줄인다고 실험 가가 주장한다.'], ['batch-counter', '실험 나는 입력이 적으면 일괄 처리의 지연 시간이 늘어남을 관찰했다.']]),
  q('contra-ko-2', 'ko', 'contradiction', '일괄 처리는 항상 빠른가 입력이 적을 때', [['batch-claim', '항상 지연 시간을 줄인다고'], ['batch-counter', '입력이 적으면 일괄 처리의 지연 시간이 늘어남']]),
  q('contra-en-1', 'en', 'contradiction', 'compression transfer time claim and counterexample', [['compression-claim', 'compression reduces transfer time for every payload.'], ['compression-counter', 'compressing encrypted payloads increases transfer time.']]),
  q('contra-en-2', 'en', 'contradiction', 'does compression always help encrypted payloads', [['compression-claim', 'Trial A claims compression reduces transfer time for every payload.'], ['compression-counter', 'Trial B found that compressing encrypted payloads increases transfer time.']]),
  q('contra-mix-1', 'mixed', 'contradiction', 'Replica reads always current 반례', [['replica-claim', 'Replica reads are always current라는 주장이 있다.'], ['replica-counter', '비동기 replica는 복제 지연 동안 오래된 값을 반환한다.']]),

  q('stale-ko-1', 'ko', 'stale', '아틀라스 현재 점검 주기', [['atlas-current', '현재 아틀라스 점검 주기는 여섯 시간이다.']], ['atlas-retired']),
  q('stale-ko-2', 'ko', 'stale', '아틀라스 과거와 현재 점검 주기 비교', [['atlas-current', '현재 아틀라스 점검 주기는 여섯 시간이다.'], ['atlas-retired', '과거 아틀라스 점검 주기는 하루였다.']]),
  q('stale-en-1', 'en', 'stale', 'current Atlas interval', [['atlas-current', 'The current Atlas interval is six hours.']], ['atlas-retired']),
  q('stale-en-2', 'en', 'stale', 'compare current and retired Atlas interval', [['atlas-current', 'The current Atlas interval is six hours.'], ['atlas-retired', 'The retired Atlas interval was twenty-four hours.']]),
  q('stale-mix-1', 'mixed', 'stale', 'Atlas 현재 interval', [['atlas-current', 'The current Atlas interval is six hours.']], ['atlas-retired']),

  q('rel-ko-1', 'ko', 'relation', '지도자 교체 절차 선행 조건', [['lease-rule', '선출된 작성자는 유효한 임대를 확보해야 한다.']]),
  q('rel-ko-2', 'ko', 'relation', '지도자 교체 연결된 임대 규칙', [['lease-rule', '만료된 임대는 쓰기 권한을 주지 않는다.']]),
  q('rel-en-1', 'en', 'relation', 'signing key migration verification overlap rule', [['rotation-rule', 'The previous verification key remains available for seven days after rotation.']]),
  q('rel-en-2', 'en', 'relation', 'signing key migration linked requirement', [['rotation-rule', 'The previous verification key remains available for seven days after rotation.']]),
  q('rel-mix-1', 'mixed', 'relation', '종료 shutdown 선행 조건', [['queue-rule', 'Queue drain 전에 producer를 중지한다.']]),

  q('multi-ko-1', 'ko', 'multisource', '자료 이전 허용 시간과 복구 조건', [['migration-window', '자료 이전은 일요일 두 시부터 네 시까지 허용한다.'], ['migration-backup', '자료 이전을 시작하기 전에 복구 가능한 백업을 검증한다.']]),
  q('multi-ko-2', 'ko', 'multisource', '자료 이전 준비 시간표 백업', [['migration-window', '일요일 두 시부터 네 시까지'], ['migration-backup', '복구 가능한 백업을 검증한다.']]),
  q('multi-en-1', 'en', 'multisource', 'release readiness approvals and rollback', [['release-quorum', 'A release requires two independent approvals.'], ['release-rollback', 'A release must retain the previous artifact for rollback.']]),
  q('multi-en-2', 'en', 'multisource', 'release readiness requirements', [['release-quorum', 'two independent approvals'], ['release-rollback', 'retain the previous artifact for rollback']]),
  q('multi-mix-1', 'mixed', 'multisource', 'Restore 복구 순서 checksum 검증', [['restore-order', '원문을 먼저 복구하고 인덱스를 나중에 재생성한다.'], ['restore-check', '원문 checksum을 백업 manifest와 비교한다.']]),

  q('none-ko-1', 'ko', 'noanswer', '수성 지하철 요금표', []),
  q('none-ko-2', 'ko', 'noanswer', '해왕성 산호 양식법', []),
  q('none-en-1', 'en', 'noanswer', 'quasar marmalade recipe', []),
  q('none-en-2', 'en', 'noanswer', 'unicorn submarine tariff', []),
  q('none-mix-1', 'mixed', 'noanswer', '달나라 zeppelin 면허증', []),
];

export const evaluationNotes: CorpusNote[] = [...corpusNotes, ...addedEvidenceNotes];
// Keep original objects, labels, order, queries and gold, including legacy KO labels
// on some English queries. Relabeling them would change the original contract.
export const evaluationQuestions: EvidenceQuestion[] = [...corpusQuestions, ...addedEvidenceQuestions];
