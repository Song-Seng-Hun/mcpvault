# MCPVault 탐색·복구·축 간 연계 개선 계획 및 실행 기록

사용자 승인: 2026-09-10. 기준: `main` `f4884bc6`. 아래 계획은 조사에서 확인한 13개 후보를 구현한다. 계획 단계의 무변경 조건은 이후 명시적인 구현 요청으로 종료되었다.

## 불변 조건

- 기존 브랜치에서 순차 구현하며 공유 파일은 단일 작성자가 소유한다. 기존 unrelated/untracked 파일과 NAS Vault/world/economy/credentials를 보존한다.
- Story 연속 인계와 제한된 Git 복구를 포함한다. 공개 연합은 오프라인 캐시 읽기를 유지하되 최신성 미확인을 표시한다.
- 새 서비스/저장소/오케스트레이터/색인을 만들지 않는다. 기존 Markdown 기록과 파생 색인을 확장한다. 지식 검증, Work 승인, Story 채택, Quest 정산의 권한을 합치지 않는다.
- 고정 MCP 도구 5개와 기존 동적 엔드포인트를 유지한다. 기존 operation/입력/응답 계약만 확장하고 MCP/REST/스키마/안내/read-only/capability를 함께 갱신한다.
- 과거 인계나 검토 완료를 추정해 채우거나 Vault 전체 마이그레이션을 하지 않는다.

## A — 호스트 경계와 실행 가능성 판정

- [x] Roleplay의 모든 상위 패키지 탐색을 작은 공통 유틸리티로 추출하여 Skill에도 적용한다. 중첩 release와 바깥 source checkout 모두 제외한다. Vault 격리, canonical/link/ACL/key 검사와 비공개 오류를 유지한다.
- [x] Economy 금융 상세와 무료 변경 가능 판정을 분리하고 읽기와 실행 가드가 같은 조건을 사용한다.
- [x] Work board/packet/pulse의 접근 가능한 작업에 같은 판정을 적용한다. 비경제 계정에는 계약/금액/소유자 없이 일반 변경 불가만 알린다. 경제 상태 불명은 fail-closed이다.
- [x] 차단 작업에 claim 등 일반 변경을 권하지 않고, 금융 열람 권한이 있는 사용자에게만 기존 Quest 경로를 제공한다.

## B — 페이지 완결성과 연합 최신성

- [x] 댓글 `afterCommentId`를 replica `after`에 연결한다. 선행 slice 없이 전체 응답 봉투에 limit/maxChars를 적용한다.
- [x] 남은 항목은 truncated, 마지막 전달 커서, afterCommentId nextAction을 반환한다. contextBefore는 진행 커서를 후퇴시키지 않는다. 첫 항목도 못 담으면 완료가 아닌 예산 재시도를 안내한다.
- [x] Skill 첫 10개가 부적합하고 cursor가 있으면 기존 skill.candidate list 다음 페이지 행동을 반환한다. 자동 순회/영구 cursor는 없다.
- [x] 모든 연합 읽기(게시글/댓글/프로필/목록/직접 객체)는 공통 sync {state: caught_up|partial|unavailable, cursor, bounded reason codes}를 반환한다.
- [x] 연결/서명 실패에는 마지막 검증 캐시만 반환한다. 최신 삭제/moderation 보장 없음, 원시 오류/호스트 경로 비노출. 부분 동기화에서 없는 객체를 확정 부재로 표시하지 않는다.

## C — 조회와 반복 쓰기 감소

- [x] Pulse를 checkpoint → assigned Work/tasks → notifications → maintenance → optional 순서로 지연 조회한다. 부가 채팅/아이디어/평판 오류가 확인된 재개를 막지 않는다. skipped/unavailable을 빈 목록/0으로 위장하지 않고 선택 작업 권한/revision 검사를 유지한다.
- [x] fiction 제외의 전체 10k 사전 inventory를 제거한다. 기존 lexical/semantic 색인에 isFictionDomain 분류를 후보 top-K 전에 적용하고 선택 결과를 현재 Markdown으로 재검증한다. 구형 cache의 미분류는 비허구로 가정하지 않고 기존 재구축을 사용한다.
- [x] 적용 사례는 정규화된 대상 참조 소유자를 metadata 단계에서 먼저 고른 후 8-owner/output budget을 적용한다. scope/실제 기록/final revision 검사를 유지한다.
- [x] Federation projection은 동일 내용 쓰기 0회, 변경 target atomic replace(사전 삭제 금지), obsolete category만 제거한다. hidden/tombstone은 public 제거 우선. 누락 파일/부모 도착 복구를 유지한다.

## D — Workshop/독립 연구 복구와 종료

- [x] 기존 manage에 reconcile_output {outputId, outputRevision, reason}, expectedRevision/request replay를 추가한다. 현재 facilitator가 접근 가능한 기존 출력의 ID/원래 receipt/integrity를 검증하여 workshop_outputs에 복구 결과를 기록하고 pending을 해제한다. 근거 drift는 unresolved. 출력/Work/Decision 승인은 수정하지 않는다.
- [x] 출력 부재는 cancel_output, mismatch/tamper/hidden/race는 거부한다. 과거 delegate 권한은 불가하다.
- [x] close payload.outcome=unresolved와 명시 사유로 오래된 근거를 승인하지 않고 종료한다. pending은 먼저 취소/조정해야 한다. 일반 close의 final step/synthesis 조건은 유지한다.
- [x] research read field=status는 현재 권한 아래 round revision/phase/최소 basis state/closure action만 반환한다. stale basis 때문에 최소 조회를 막지 않되 제출/설정/봉인 참여/hidden locator를 노출하지 않는다. disclosure/review/synthesis는 기존 검증을 유지한다.

## E — Story 연속 인계와 Git 복구

- [x] Work handoff accept의 기존 work_changes(16개)에 from/to account, from/to generation, proposal revision, acceptor를 기록한다.
- [x] Story start/reconnect에 확인 Work revision/generation을 저장한다. 일반 resume은 writer를 바꾸지 않는다.
- [x] story.session reconnect_preview는 현재 showrunner/project 권한 아래 연속 수락 증명을 검증한다. 권한 있는 read-only 세션도 허용한다.
- [x] includeGitHistory=true 명시 시에만 기존 GitHistoryService를 이용한다. 해당 Vault repo의 정확한 task path, 고정 HEAD first-parent, 최근 변경 commit 100개, body 32개, 각 512KiB, 총 8MiB, 10초 이내. rename 추적/자동 git init/commit/fetch/checkout/history rewrite 금지.
- [x] 실제 수락 상태의 담당자/generation/task/project ID를 검증한다. commit 작성자/설명은 승인이 아니다. 미커밋 중간 인계, release/reclaim 단절, 충돌/상한은 증명 부족이다.
- [x] reconnectProofFingerprint는 session/project/work revision/generation/chain/Git basis에 묶인다. resume은 같은 증명과 Work CAS guard를 재검증하여 writer만 변경한다.
- [x] 기존 단일 인계는 호환, 다중은 proof 필수. 구형 session도 시작 writer 연결이 유일해야 한다. 증명 없으면 기존 원본/결과를 보존하는 새 session을 안내한다. Git 미설정에서는 현재 기록만 사용한다.

## F — 중복 참조 검사 정리

- [x] Synthesis/Investigation/Application의 본문 link precheck/normalization 및 요청 내 metadata memo를 기존 ReferenceService 주변에 모은다. 먼저 허용/거부 동일성 테스트를 고정한다.
- [x] link count/self-reference/historical revision/knowledge type/result submission은 각 도메인 소유이다. write-time access/revision 검사를 유지하고 범용 workflow framework로 확대하지 않는다.

## 검증 및 배포 완료 기준

각 단위: RED → 최소 GREEN → 대상 테스트 → build → 전체 tests → diff check. 각 배포 묶음은 guidance:generate/build/대상 및 전체 npm test/guidance:check/git diff --check를 통과한다.

필수 회귀: nested host/source/junction/ACL/Vault; 댓글 30→20 및 100+ 순회/작은 예산/커서; 첫10 Skill 탈락; federation offline/bad signature/partial/cache absent/late hide; paid owner/nonowner/free/settled/drift/leak; checkpoint optional zero calls/errors/required auth; nonfiction10001/fiction-before-topK/classification drift/old cache; irrelevant8 applications; unchanged pull0 writes/missing repair/transition/replace failure; Workshop lost response+basis drift/concurrent recovery/unresolved close/revocation; sealed research status; Story ABC/history eviction/Git missing middle/release gap/budget/legacy/race; refs relative/scope/alias/fences/hidden/ambiguous/duplicate/write-time revoke.

性能은 추정 시간 대신 lookup/candidate/write count로 기록한다. 기존 87 tests는 기준일 뿐 새 회귀/전체 검증을 대체하지 않는다.

- [x] 경로/경제/봉인/Git 복구는 구현과 독립된 검토를 통과한다.
- [x] 기존 NAS runtime/launcher rollback을 보존하고 배포 후 실제 MCP schema/read/대표 탐색을 검증한다. 변경 동작은 격리 fixture에서 검증하며 운영 데이터 시험 변경/Enterprise 자동 활성화는 없다.
- [x] source+dist를 같은 commit으로 사용자 fork의 기존 main에 push한다. 패키지/release/upstream PR/force push는 금지한다.
- [x] 마지막 배포/push 후 전 축과 접합부를 두 번 재점검한다. 수정 시 검증을 갱신한다.
- [x] 최종 운영 코드/테스트/생성물/문서 증감을 분리하고 조회/쓰기 감소 및 복구 시나리오, 의도된 거부와 남은 결함을 구분한다.

## 실행 기록

### 최종 통합 검증·NAS 배포 (2026-09-11 KST)

- `npm test -- --maxWorkers=1`: **377 files PASS, 5260 tests PASS, 2 existing SKIP**, exit 0, 1442.09초. 이 결과는 앞선 실패/대상 테스트 결과를 대체하는 최종 A–F 전체 검증이다. 제한 시간과 보안 단언은 완화하지 않았다.
- 최종 guidance generate/check: 4517 entries, 5118 occurrences, pending 0. build와 diff check PASS. 전체 실행 전후 소스/테스트/설정 667개 SHA-256은 `d1d4443a7d617e8a4c03db5741aaae91af272a652e701516ae1362c52bb6e936`으로 동일하다.
- `20260911-cross-axis-final/release`의 dist 753개와 package를 원본 해시로 대조했다. 기존 refinement-2 runtime과 `launcher-before.ps1`을 호스트 전용 rollback 자료로 보존했다. 정확한 기존 예약 작업·PID·생성 시각·명령을 확인한 뒤 새 PID 18028(2026-09-11 04:35:02 KST)로 전환했다.
- 실제 NAS MCP 읽기 검증: fixed tools 5, endpoints 269, catalogue pages 5, 한국어/영어 대표 탐색 8, exact schema, notice receipt, canonical status/legacy deny, 기존 optional hosts, Workshop reconcile/unresolved, Research status, Story proof opt-in/authenticated preview 계약 PASS. 인증된 Pulse 세부 동작과 변경 operation은 격리 tests에서만 검증했다.
- world seq2/turns2와 economy seq1/journals1 및 각 canonical hash는 배포 전후 동일하다. 원장·출력·연구 기록에 시험 쓰기 없음, Enterprise 운영 활성화 없음, 키/설정/PDF opt-in 유지. 런타임/비공개 자료는 커밋하지 않는다.
- source+dist 배포 커밋 `a8095eb4aa27411a096b9d8a951629950a4e1202`를 사용자 포크 `Song-Seng-Hun/mcpvault`의 기존 main에 일반 push했고 원격 ref 일치를 확인했다. 패키지/release/upstream PR/new branch/force-push 없음. 기존 미추적 조사 문서 6개와 호스트 자료를 보존했다.
- 배포·push 후 1차 점검: A–F 및 Work–Economy–Pulse, cursor–sync–projection, fiction–Application–공통 참조, Workshop–Research–Story/Git의 권한·예산·revision 연결부를 재확인했다. 새 결함을 발견하지 못했다. 소스 667개/배포 dist 753개 불변 해시, guidance check, 전체 commit diff check, 실제 NAS MCP 읽기와 world/economy 보존 재검증도 PASS이다.
- 배포·push 후 독립 2차 점검도 PASS: A–F, 서비스 연결·스키마·read-only/capability와 핵심 생성 JS를 대조했고 새로 입증된 수정 필요 결함은 없었다. 검토자가 직접 HEAD/원격 main=`a8095eb4`, source/dist 무변경, commit diff check를 확인했다. 독립 점검은 정적 감사이며 전체 테스트/live 결과를 재실행한 것으로 주장하지 않는다. 이 완료 기록만 후속 문서 커밋하며 운영 소스·배포는 바꾸지 않는다.
- 아래 과거 기록의 미완료 표현은 해당 시점의 기록이며, 최신 상태는 이 최종 기록을 따른다.

### 변경량 분리 집계

기준 `f4884bc6` 대비 집계. 운영 소스/테스트/생성물은 배포 커밋 `a8095eb4`로 고정되어 있고, 문서에는 이 완료 기록을 포함한다.

| 구분 | 파일 | 추가 줄 | 삭제 줄 | 순증 |
| --- | ---: | ---: | ---: | ---: |
| 운영 TypeScript (테스트·생성 안내 제외) | 36 | 1171 | 334 | 837 |
| 테스트 | 27 | 2148 | 37 | 2111 |
| 생성 안내 TypeScript | 1 | 2252 | 1491 | 761 |
| dist 생성물 | 87 | 3790 | 1888 | 1902 |
| 문서 | 10 | 375 | 1 | 374 |

운영 코드 순증은 새 서비스/원장/색인이 아니라 제한된 Git 관찰과 연속 인계 증명, Workshop 출력 무결성/재실행 확인, 봉인 연구 최소 상태, 연합 예산·최신성/복구 및 마지막 권한·revision 검증을 기존 서비스에 추가한 결과이다. 공통 경로 경계·금융 변경 판정·링크 검사 중복과 전체 허용 문서 inventory는 제거했다. 아래 호출/쓰기 측정은 이 코드 증가를 처리시간 향상으로 환산하지 않는다.

### 측정값과 의도된 보수적 거부

| 대상 | 확인한 변화 | 측정 범위 |
| --- | --- | --- |
| Pulse checkpoint | eager 11종 조회 → continuity 1회, 하위 조회 0회 | 서비스 호출 수; 전체 I/O/응답시간 아님 |
| 비허구 검색 | 전체 허용 목록 사전 queryNotes 0회 | 10,001-row fixture 및 fiction 선행 후보; 기존 색인 admission/current-hit guard 유지 |
| Application | 지식 + 실제 참조 owner metadata 2회 | 무관한 owner 8개가 앞선 fixture; 전체 filesystem I/O 아님 |
| Federation | 동일 사본의 두 번째 pull에서 imported 파일 쓰기 0회 | 파생 파일 쓰기; 네트워크/상태 파일 I/O 0회 주장 아님 |
| 공통 참조 | 같은 input fresh metadata 7회 → 1회 | 한 publish 요청; cache-hit ACL와 최종 revision/access 재검증 유지 |

- 연결 증명 없는 구형 Story, 미커밋 중간 인계, release/reclaim 단절, Git 부재/상한/HEAD 변경은 자동 복구하지 않는다. 원본/결과를 보존한 새 세션이 안전한 대안이다. Git commit 작성자/메시지는 승인이 아니다.
- 과거 Decision 출력에 full-state 무결성 witness가 없으면 `reconcile_output`은 원본과 pending을 보존하며 거부한다. 최신 creation revision을 추정하거나 과거 검토를 backfill하지 않는다.
- Federation의 unavailable/partial 캐시는 최신 삭제·moderation 반영을 보장하지 않는다. 공개 사본이 없다는 것만으로 확정 부재로 판단하지 않는다.
- Workshop의 unresolved 종료는 지식/Work/Decision/Story/Quest 승인을 대신하지 않는다. 읽기 전용 preview/status도 현재 계정·프로젝트 권한이 필요하다.
- 위 항목은 의도된 거부/한계이다. 최종 전체 suite, NAS 활성화 및 배포 후 두 차례 점검의 결과는 별도 완료 기록으로 남긴다.

### E — Story 연속 인계와 Git 복구 (2026-09-11 KST)

- 실제 Work acceptance 한 이벤트에 from/to 계정·세대, CAS로 검증된 제안 revision과 acceptor를 추가했다. 기존 16개 cap을 유지하며 제안자의 현재 담당자 일치와 안전 정수 세대를 확인한다. Story start/reconnect는 관찰된 Work binding을 저장하고 일반 resume은 writer를 바꾸지 않는다.
- 현재 showrunner의 `reconnect_preview`는 읽기 전용 서버에서도 인증·write/task capability·현재 Story/Work membership 아래 허용한다. MCP/REST 동등 결과와 익명 거부/읽기 전용 resume 거부를 실제 adapter fixture로 확인했다. 고정 5도구/기존 동적 endpoint 내 operation만 확장했다.
- 현재 events 또는 명시적 Git fallback에서 연속 수락 상태를 증명한다. Git은 exact task path·해당 Vault root·고정 HEAD first-parent·100 changed commits/32 bodies/512 KiB each/8 MiB total/공통 10초를 제한한다. raw blob size를 먼저 읽고 shallow/rename-away/deletion/상한·HEAD drift·ACL 변경 시 부분 증명을 반환하지 않는다. 자동 init/commit/fetch/checkout/rename 추적 없음. Git helper 30 tests PASS 및 독립 SPEC/QUALITY 승인.
- Git에서는 서로 인접한 실제 이전 담당자/세대와 수락 상태를 비교한다. 나중 snapshot에 복사된 예전 이벤트·commit author/message·미커밋 중간 인계는 증거가 아니다. 현재 Work가 최신 Git보다 rollback되었거나 같은 세대의 담당자가 충돌하면 거부한다.
- proof는 session/Story project/Work project/task revision·generation·chain·Git HEAD/blob에 묶이며, 실제 guarded writer에서 같은 증명을 재계산한다. 다단계/Git 복구는 fingerprint 필수이며 명확한 단일 인계 입력은 호환한다. retry도 현재 writer/editor membership, 저장된 after-binding, task revision과 사용한 Git basis를 재확인한다. 원고/editor/Work 승인·결과는 변경하지 않는다.
- 독립 검토에서 구형 create marker만으로 유일성을 추정한 문제, live Work rollback, retry의 writer/editor 재인가 누락을 실제 RED 3건으로 확인하고 수정했다. known release/malformed accepted state는 부족한 근거와 구분하여 Git 호출 전에 거부한다. 최종 claimed-binding release 순서 문제도 RED(불필요 Git 1회) → GREEN(0회)으로 수정했다.
- 핵심 Story/계약 18 PASS(77.56초), 실제 read-only MCP/REST 1 PASS, 넓은 Story/Work/Git 14파일 396 PASS(392.85초). 마지막 release 순서 수정은 대상 1 PASS(4.49초)이며 최종 전체 suite에 다시 포함한다. Story SPEC/QUALITY도 승인. guidance generate 4517 entries/5118 occurrences/pending0 및 당시 build PASS. 최종 추가 호환 회귀·F 변경 후 build/full suite/deployment는 별도 최종 기록으로 확인한다.

### F — 참조 검사 공통화 (2026-09-11 KST)

- 기존 세 preparer의 상대 경로·별칭·fragment·scope·fence·occurrence budget·hidden/ambiguity·self/historical/result 규칙 47건을 공통화 전에 통과시켰다. encoded separator는 기존 거부를 유지했다. 별도 RED에서 하나의 출판에 같은 input metadata를 7번 읽는 중복과 request-local reader 부재를 확인했다.
- 기존 ReferenceService에 strict structured-body path precheck/resolution과 exact-path request-local metadata reader를 모았다. 도메인별 scope/lexical precheck 차이, 16/8 occurrence 한도, self-reference/duplicate/historical/current revision/result-plan 판단은 해당 도메인에 남겼다. 일반 note body의 permissive 동작도 그대로다.
- 한 publish 요청에서 Application/Synthesis/Investigation이 같은 metadata observation을 재사용한다. fresh/strict/8 MiB 초기 읽기, 매 cache hit의 scope+caller ACL, 최종 writer의 revision/access guard를 유지한다. 기존 Application read cache/관찰 집합/마지막 재검증과 C의 owner admission은 변경하지 않았다. cache는 요청이 끝나면 폐기하며 새 저장소/서비스/워크플로를 만들지 않는다.
- 신규 49 tests PASS 후 scope ACL cache-hit, normalized duplicate, 실제 dispatch 권한 철회 검증을 추가했다. 관련 8파일 274 tests PASS(65.60초). 같은 input의 fresh metadata call은 7→1이며 전체 filesystem I/O 또는 처리시간이 7배 개선되었다는 뜻은 아니다. 독립 SPEC 승인, QUALITY 검토 및 최종 build/full suite/deployment는 진행 중이다.
- 후속 독립 QUALITY도 승인했다. E의 마지막 claimed-binding 순서와 유일한 구형 단일 인계 호환성 테스트 2 PASS(5.62초). 최종 guidance generate/check(4517 entries/5118 occurrences/pending0), build 및 diff check PASS. 이제 소스/테스트를 고정하고 전체 suite를 직렬 실행한다. NAS 런타임은 여전히 refinement-2이며 활성화/commit/push는 전체 검증 이후다.

### D — Workshop/독립 연구 복구 (2026-09-11 KST)

- Research `field:status`는 일반 projection을 사용하지 않고 revision/phase/최소 basis state와 현재 facilitator의 unresolved-close 입력 안내만 반환한다. 설정·봉인된 제출·참여 목록·source locator를 제외한다. 512..12000 예산과 detail cursor 거부, 64자 ID에서 유효 예산 초과도 검증했다.
- 최종 source I/O 뒤 round/workshop/actor 검증 순서를 수정했다. source revision 읽기 중 parent handoff 또는 round 종료, 마지막 round 읽기 중 parent handoff의 RED 3건을 확인한 뒤 거부하도록 수정했다. 다중 파일 원자적 snapshot을 주장하지 않는다.
- `reconcile_output`은 현재 facilitator, exact original output receipt와 현재 full-state integrity, 출력 CAS 및 반대 타입 부재를 확인하여 Workshop의 기존 outputs/receipt만 쓰고 pending을 해제한다. 근거 변경은 unresolved로 보존하며 출력/승인은 바꾸지 않는다. 재시도에서도 최종 output/workshop revision과 반대 타입 부재를 다시 확인한다.
- 미래 Decision 출력에는 최종 Properties+본문의 versioned seal을 남긴다. 과거 full-state witness가 없는 Decision은 추정/backfill하지 않고 원본+pending을 보존하며 복구를 거부한다. Work는 기존 생성 receipt의 현재 state digest를 사용한다. 정상 claim 뒤 남은 과거 creation revision도 현재 원본 무결성으로 인정하지 않는 실제 서비스 테스트를 추가했다.
- `close {outcome:unresolved,reason}`은 오래된 근거나 미완료 논의를 승인하지 않고 명시 종료한다. pending 차단, 일반 close의 final-step/synthesis gate는 유지한다. unresolved terminal 읽기는 stale source 확장 없이 closed를 반환한다.
- 초기 출력/연구 5파일 67 tests PASS. 추가 보안/예산 회귀 후 새 2파일 26 tests PASS(22.97초): Workshop 14, Research 12. 독립 SPEC/security 및 후속 QUALITY 승인, 발견된 replay 누락 두 건도 각각 RED→GREEN. 기존 영역의 넓은 직렬 회귀 검증은 아래 후속 기록으로 구분한다.
- guidance:generate/check 4502 entries/5100 occurrences/pending0, build PASS, git diff --check PASS(줄바꿈 변환 경고만). 전체 A–F suite, NAS 배포와 commit/push는 아직 수행 전이다.
- 넓은 D 직렬 검증(15파일)은 285 PASS/6 timeout FAIL(222.24초)이었다. 두 기존 권한 검증 fixture가 매 호출마다 보호 출처를 수정하여 새 lock-time 인증 확인에서 자기 잠금을 기다렸고, 뒤의 같은 파일 테스트가 연쇄 대기했다. 운영 검증을 제거하지 않고 실제 외부 변경 주입을 한 번으로 제한하고 주입 실행 여부를 단언했다. 같은 파일 7개는 기존 5초/60초 제한 그대로 PASS(29.78초). 실제 MCP logout을 lock-time 첫 인증 이후 주입하는 unresolved-close 회귀도 추가했으며, fixture SPEC/QUALITY 검토를 통과했다. 이 결과를 전체 suite 통과로 간주하지 않는다.
- 수정 fixture와 새 복구 테스트의 결합 실행 22 PASS(50.62초); 빌드된 운영 소스는 그대로이며, 최종 전체 A–F 검증에서 다시 포함한다.

### 통합 검증 보완과 최종 배포 묶음 (2026-09-11 KST)

- A–C 전체 직렬 실행: 372파일 중 368 PASS/4 FAIL, 5123 tests PASS/7 FAIL/2 SKIP, 1287.50초. 시간 초과가 아닌 기존 fixture/내부 계약 기대 7건이 실패했다. 전체 통과로 취급하지 않는다.
- Application의 정확한 owner admission 이후 빈 `Run.md`가 읽히지 않아 late-ACL fault injection 4건이 실행되지 않았다. 실제 Root 적용 기록으로 수정하고 baseline 출력, 기존 거부/권한철회, 정확한 Run 검증 횟수 2/3을 모두 단언했다. 운영 guard는 변경하지 않았다.
- Semantic adapter mock은 구형 ACL 기반 fiction inventory 대신 명시적 `fictionDomain`/`includeRevisions`와 실제 파일 revision을 사용하도록 수정했다. 실제 native vector pre-top-K 테스트는 별도로 유지한다. Social의 4k bounded route/coverage와 12k 원본 structured context를 모두 검증한다. Reputation의 선택 활동 시 생략과 실제 Markdown 집계를 사용하는 idle fallback을 분리 검증했다.
- 변경된 4파일 68 tests PASS(22.48초), 독립 spec/quality 승인. 최종 전체 suite 통과는 아직 남아 있다.
- 사용자가 승인한 범위는 그대로 두고, D–F를 포함한 하나의 최종 배포 묶음으로 조정한다고 알렸다. A–C 후보와 rollback은 보존하되 활성화하지 않는다. 현재 NAS 런타임은 이전 refinement-2이며, 최종 guidance/build/대상 및 전체 tests/live verification 후 기존 main에 source+dist commit/push한다.

### 시작

- `f4884bc6`, main=origin/main. 추적 파일 clean. 기존 `.agents/`, `.mcpvault/`, 2026-09-09 조사 문서 6개, `scripts/__pycache__/`는 제외/보존한다.
- 순차 단일 작성자, 독립 읽기 검토. 새 branch/worktree 없음. 본 계획과 대상 테스트부터 시작한다.

### A — 구현 및 검증 진행 (2026-09-10/11 KST)

- 호스트 RED: 중첩 release로 실행 위치를 바꾼 fixture가 바깥 checkout의 private config를 허용했다. 상위 package 탐색을 공유한 뒤 Skill/Roleplay 19개 테스트 통과. 실패한 source boundary 탐색 오류도 경로 없이 처리한다.
- Work RED: 금융 projection이 없는 계정에 work.claim 안내가 남았고, 판정 중 상태 변경 및 원장 불가를 표현하지 못했다. 기존 active-contract predicate를 guard/읽기가 공유한다. 추가 상태는 `taskMutation`(allowed/managed/unavailable)이며 계약/금액은 포함하지 않는다.
- packet은 action 준비 전후 판정을 확인한다. board는 현재 판정을 cursor fingerprint에 포함한다. pulse는 일반 작업 불가 대상을 무료 후보에서 제외하며 금융 권한이 있는 경우만 기존 packet/Quest 경로를 유지한다. 실행 시 기존 ledger/Work guard는 계속 재검증한다.
- 대상 5파일 106 tests PASS; guidance generate/check PASS (4472 entries, 5059 occurrences, pending 0); build PASS. 전체 기본 실행에서 일부 기존 5초 테스트가 제한을 넘겨 원인 확인 중이며 전체 통과/배포 완료를 아직 주장하지 않는다.
- A staged release: `.mcpvault/deployments/20260910-cross-axis-a/release`, dist 750개 해시 일치. 이전 refinement-2 runtime과 launcher-before 보존. preflight PASS; 기존 server PID32908/parent12424, roleplay seq2 및 economy seq1 그대로. 아직 restart/commit/push 없음.
- 독립 검토 A1 승인. A2 검토에서 inherited `constructor` 값/visible decoy task_id/작은 all-blocked pulse 봉투를 지적했다. 5개 RED 단언을 확인 후 own-property 및 shape 검사, canonical managed-task identity, 공통 예산 검사로 수정했다. 관련 7개 tests PASS, Work/Economy 3파일 92개 tests PASS. 금융 task ID의 기존 예약어 제한은 바꾸지 않았다.
- 전체 기본 실행: 368파일, 5063 PASS/4 FAIL/2 SKIP, 428.96초. 실패는 모두 기존 5초 timeout(Story adopt/reject, Workshop 다수 transcript, Roleplay MCP)이며 기능 단언 실패 없음. 같은 소스/timeout으로 해당 3파일을 `--maxWorkers=2`로 재실행해 49 PASS(98.11초). 수정 후 전체 검증도 동시 실행 수 2로 재검증한다. 제한 시간/단언을 완화하지 않는다.
- A 수정 후 전체 `--maxWorkers=2`: 367/368파일, 5071 PASS/1 timeout FAIL/2 SKIP, 711.02초. 유일한 실패는 Roleplay MCP의 기존 5000ms 제한이며 단독 `--maxWorkers=1`은 본문 4.82초로 PASS(전체 13.11초). 병렬 부하에 대한 시간 여유가 매우 작다는 근거이며, 전체 통과로 간주하지 않는다. source/build와 stage를 보존하고 A 배포는 보류한다. A 다음 B를 순차 구현하여 A+B 배포 묶음으로 전체 직렬 검증한 뒤 배포/commit/push한다. 중간 restart는 없고 제한/단언은 유지한다.

### B — 구현 및 대상 검증 (2026-09-11 KST)

- 실제 11개 Skill 후보의 조회 순서 앞 10개를 거절한 회귀: 기존 nextAction=undefined RED → 기존 `skill.candidate` list continuation GREEN. 1회 inventory만 읽으며 자동 순회/영구 cursor 없음. Skill 독립 검토 승인.
- 연합 댓글 30→20/10, 105개 순회, 전체 JSON/prettyPrint 예산, overlap 비진행, cursor 오류, 작은 예산 재시도를 검증했다. 최초 RED에서 false completion 및 cursor 없음 확인.
- 모든 연합 읽기에 caught_up/partial/unavailable, 검증 cursor, 고정 reason codes를 추가했다. offline/bad signature는 마지막 완전 캐시를 사용하며 부재는 verified/unverified로 구분한다. 갱신 실패 때 부분 적용된 메모리는 되돌리고 다음 pull이 파생 파일을 복구한다.
- 독립 검토의 로컬 게시글 fallback/list moderation 우회, 일반 post 전체 예산, cold bridge JSON 오류 노출을 4개 RED로 재현 후 수정했다. 같은 local profile 우회도 RED→GREEN. 원격/로컬 ID 모두 검증된 hide/tombstone을 따른다.
- 25k 댓글은 최대 예산 반복 재시도 대신 oversized_item 및 기존 revision-pinned line/column reader를 제공한다. 실제 반입 Markdown 일치와 SHA-256을 확인하고, unread cursor는 유지한다. 다음 댓글 이동은 명시적 continuationAfterRead이며 자동 읽음/skip 없음. 변조된 파일/오래된 federation revision의 locator도 거부한다.
- 연합/Skill 대상 8파일 71 PASS(160.93초), 최종 새 연합 회귀 15 PASS(17.38초). B 연합 독립 spec/security/quality 검토 승인. build PASS, guidance 4479 entries/5070 occurrences/pending0. 이는 전체 suite/배포 완료를 대체하지 않는다.
- A+B stage `.mcpvault/deployments/20260910-cross-axis-ab/release`, dist 750개 해시/원본 package 일치, old refinement-2와 launcher-before 보존. 읽기 전용 preflight PASS; 기존 PID32908 및 world seq2/economy seq1 해시 유지. 아직 활성화/commit/push하지 않았다. 최종 전체 직렬 검증을 수행한다.

### A+B 전체 결과와 C 배포 묶음 조정

- 전체 `--maxWorkers=1`: 368/369파일, 5087 PASS/1 timeout FAIL/2 SKIP, 1362.56초. 실패는 semantic-reuse 첫 Properties-only 테스트의 5026ms 제한 초과. 같은 5초 제한 단독 재실행은 본문/정리 543ms, 전체 23개 재실행은 2.33초로 통과했다. 계측에서 첫 getDb 326.7ms, 첫 prepare 343.7ms/전체381.1ms, 다음 prepare18.1ms/전체50.4ms를 확인했다. 초기화 비용은 확인했지만 5초 초과 전체 원인이 입증된 것은 아니다.
- 실제 native DB 연결을 semantic fixture의 beforeEach로 옮겼다. 별도 Roleplay 단독 실행에서도 5083ms timeout을 재현하고 서버/두 클라이언트/세 계정 준비 603.3ms를 확인했다. 동일한 실제 HTTP/auth 준비를 beforeEach로 분리했다. 모든 기능/보안 단언과 5초 본문 제한은 그대로다. 두 fixture 변경은 독립 spec/quality 검토 승인, 대상 24 PASS(17.14초). 전체 안정화 완료로 간주하지 않는다.
- C가 같은 의미 검색 검증 파일을 확장하므로 배포 묶음을 A–C로 합친다고 사용자에게 알렸다. A+B stage와 이전 운영 런타임은 유지하되 아직 배포/commit/push하지 않았다. C 구현 후 최종 전체 검증을 다시 수행한다.

### C — 적용 사례와 연합 재조정

- Application: 무관한 8개 owner가 예산을 소진해 첫 페이지가 비었던 RED를 확인했다. 기존 metadata predicate에서 정확히 정규화한 target owner를 먼저 선택한 뒤 기존 8-owner/current-source budget과 scope/본문 참조/최종 revision 검증을 적용한다. 대상 23 PASS, 독립 spec/quality 승인. indexed/fallback 양쪽 회귀에서 fresh `readNoteMetadata`는 queried knowledge + 실제 owner의 2회이며, 전체 filesystem I/O 2회라고 주장하지 않는다. 8+1 matching owner continuation, scoped/physical path 정규화, stale owner/hidden/incompatible 억제를 검증했다.
- Federation: 신규 8개 테스트에서 7 RED를 확인한 뒤, 동일 반입 파일 0회 재작성, 변경 target 1회 교체(사전 삭제 없음), missing repair/obsolete category cleanup, parent-arrival child activation, hide/tombstone의 public-removal 우선을 구현했다. storage rename EIO까지 추가하여 실제 임시 파일 정리·old target/cursor 보존·재시도를 검증했다. 신규 9 PASS, 독립 spec/quality 승인(8개 기준); broader federation 4파일 36 PASS(23.71초). 전체 I/O 0 또는 NAS 원자성 검증으로 과장하지 않는다.
- 이 두 C 변경 후 build PASS. Pulse staged-read와 fiction index admission은 아직 구현 전이며 C 전체 완료/배포를 주장하지 않는다.
- Pulse: 기존 11-source eager 조회를 우선순위 단계 조회로 바꿨다. 신규 9개 RED 후 checkpoint에서 continuity 1회/하위 0회, Work 선택에서 2회, notification 선택에서 4회를 검증했다(서비스 호출 수, 전체 디스크 I/O/지연시간 주장은 아님). loaded/skipped/unavailable과 생략된 미조회 counts를 구별한다. 현재 Work 권한 불가/필수 읽기 오류는 fallback을 허용하지 않는다.
- 실제 Work/Task fixture에서 관리 작업이 레거시 순위로 다시 추천되는 RED를 재현했다. Work가 연결된 Pulse만 project-backed tasks를 레거시 count/rank 전에 제외한다. standalone legacy task는 유지한다.
- 독립 spec/quality 검토에서 작은 예산의 coverage 손실, 26자 미만 Work 예산, Skill/hostBusy 재조회 입력 손실, unavailable을 빈 상태로 표현하는 문구를 지적했고 각각 RED→GREEN으로 보완했다. 4파일 138 PASS(40.89초), 독립 검토 승인. 전체 suite/배포 확인은 아직 남아 있다.
- Fiction: 기존 lexical snapshot v8와 semantic rows/manifest의 분류 필드를 후보/본문 hydration/top-K 전에 적용했다. 10,001-row advisory inventory fixture에서 기존 오류를 RED로 확인한 뒤 전체 metadata 사전 조회를 제거했다. 실제 22개 fiction 선행 fixture도 queryNotes 0회이며 current selected-hit 검증은 유지한다. 구형 lexical cache는 재구축, 구형 semantic 분류는 NULL/unknown으로 제외한 뒤 기존 idle worker가 복구하고 같은 벡터는 재사용한다.
- 독립 검토에서 context 확장까지 revision을 유지할 것과 최종 revision I/O 이후 및 전체 결과 반환 직전 admission을 재검증할 것을 지적했다. 양방향 분류 변경 및 마지막 I/O 중 권한 철회/다음 hit 읽기 중 이전 hit 권한 철회를 RED→GREEN으로 보완했다. Spec/quality 승인. Semantic-integrity의 현재-cache fixture에 새 필드만 추가했고 기존 실패 주입/단언은 그대로다.
- Fiction/search 대상 4파일 95 PASS, 후속 핵심 6파일 102 PASS(36.59초, maxWorkers=1). 같은 6파일 병렬 실행에서는 question-corpus의 기존 5000ms 제한을 5034ms로 초과했으나 직렬 동일 제한 실행은 통과했다. Guidance generate 4479 entries/5071 occurrences/pending0. A–C 전체 검증 및 NAS 활성화는 다음 단계다.
