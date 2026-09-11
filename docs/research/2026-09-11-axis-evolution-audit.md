# MCPVault 큰 축 재조사: 강화·연계·단순화·가지치기

## 조사 범위와 결론

- 기준: `main`, `b992261e3dff3c906217f3ca5739b399130f2bbf`.
- 이번 요청은 조사다. 구현 승인이나 배포 승인이 아니다. 소스·설정·운영 데이터는 변경하지 않는다.
- 현재 구현, 인접 테스트, 이전 refinement 실행 기록을 대조했다. 이미 해결된 항목을 새 제안으로 반복하지 않았다.
- 핵심 결론: **새로운 거대 축보다 기존 축의 경계 결함을 먼저 보강하고, 중복된 구조적 계약만 합친 뒤, 작은 명시적 연결을 추가하는 편이 가치가 크다.**
- 아래 25개는 모두 실행할 목록이 아니다. 재현된 문제, 정적 구조 개선, 사용자 선택이 필요한 확장을 구분한 후보 목록이다.
- `우선`은 다음 구현 단위의 우선순위이며, 모든 항목이 보안 취약점이라는 뜻은 아니다. 성능 개선량은 별도 측정 전까지 주장하지 않는다.

## 현재의 큰 축

| 축 | 현재 역할 | 우선 조사 결과 |
| --- | --- | --- |
| 원본·근거·지식 | 불변 Source, Claims, 검토, 합성, 적용 경험 | 근거 locator 판정 통합, 중복 후보 생성 보완 |
| 검색·상황·기억·이어하기 | lexical/semantic/document 검색, 상황별 문맥, private memory, checkpoint | 발견 범위의 계속 탐색, deadline 취소, 검증 범위 명시 |
| Community·Idea·Workshop·독립 연구 | 토론, 분기, 평가, 비공개 선행 조사와 공개 | Idea 분기·평가의 revision 보강, 연구 round 재발견 |
| Work·검토·Skill | 소유권, 인계, 검토 기준, 절차 경험과 승격 | 검토 상태와 페이지 fingerprint 연결, 과거 버전 경험 |
| Story·Roleplay·TRPG | 허구 창작, 공유 세계, 성장·구성·전투 | 작은 규칙 kernel, 도달 불가능한 가지 진단, 기록의 명시적 창작 전환 |
| 해설·벤치마크·경제 | 충실한 설명, 평가, 승인된 지갑 발행·정산 | 현재 접근 재확인, 종료/정산 구분, 판정과 추천 로직 분리 |
| 제어면·설치·Enterprise·연합 | 다섯 도구, 동적 endpoint, 호스트 승인, 격리·이식 | operation 계약 단일화, 진짜 client-only 설치, 운영 자료 커밋 방지 |

대략적인 크기도 확인했다. `src` 최상위 비테스트 TS 256개 중 생성된 guidance 파일 하나가 75,636줄이다. 따라서 전체 줄 수를 유지보수 복잡도나 dead code의 근거로 쓰지 않았다. `llm-wiki.ts` 16,710줄, `createServer.ts` 4,265줄 역시 **크기만을 이유로 분할하지 않는다**. 실제 중복 계약과 의존 방향이 있는 곳을 대상으로 한다.

## 검증 근거와 한계

이번 턴에서 실행한 기존 테스트:

- `src/agent-pulse.test.ts`: 44개 통과.
- `src/capability-refinement.test.ts`, `src/agent-pulse-stages.test.ts`: 합계 20개 통과.
- 총 3파일 / 64개 통과. 첫 명령에 존재하지 않는 `endpoint-registry.test.ts` 필터도 있었으나 실제 실행은 Pulse 한 파일뿐이었다. 이후 실제 capability 테스트 파일을 별도로 실행했다.
- 전체 테스트·빌드·NAS 검증을 이번 조사에서 다시 실행한 것은 아니다. 이전 구현 단계의 전체 통과 결과와 이번 조사 증거를 혼동하지 않는다.

저장소 수정 없이 수행한 격리 재현:

| 대상 | 방법 | 관찰 |
| --- | --- | --- |
| 근거 locator | 현재 compiled helper를 메모리에서 실행 | fenced heading/block 및 제목과 무관한 line range를 허용 |
| 상황별 후보 | 실제 selector + 메모리 조회 경계 | 일반 12개 결과가 있으면 조건으로 활성화된 별도 후보가 빠짐 |
| WikiLink | 실제 handler + 현재 최종 compactor, 메모리 FS | 50,041자 생성 후 512 예산에서 52자로 축약; revision/continuation 없음 |
| 중복 후보 | 실제 LlmWikiService + 메모리 queryNotes | 같은 stable ID, 다른 제목은 0쌍; 공통 alias 추가 시 1쌍 |
| document discovery | 실제 DocumentSearch + 메모리 경계 | retrieval hit가 없는 33번째 resource의 본문 match 누락; 직접 path/hit 제공 시 발견 |
| Work 페이지 | 실제 WorkService/ReviewEngine/page + 메모리 외부 근거 | 근거 변경 후 옛 cursor 허용, coverage 행 중복/신규 stale 경고 누락 |
| Idea 분기 | 실제 서비스/ReferenceService/retry + CAS 메모리 FS | 부모 변경 후 생성 성공; 2차 저장 실패 시 부모 연결 없는 seed 잔존 |
| 구성 그래프 | 실제 configuration checker | 필요 조건과 배타 조건이 모순인 미선택 노드가 있어도 현재 선택은 valid |
| 원격 연결 설치 | 실제 planSetup, 네트워크 호출 없음 | 로컬 program/Vault를 생략한 remote-https 연결 계획 거부 |
| Quest market | 실제 EconomyService + 메모리 FS/ledger | 뒤쪽 읽기/마지막 actor 검사 도중 앞 task/project를 숨겨도 이전 계약 제목·total 반환 |

이 재현은 실제 서비스/헬퍼와 통제된 경계의 증거다. NAS 동시성·실사용 지연시간·실제 계정 노출을 재현했다는 주장이 아니다.

## A. 먼저 강화할 부분

### R01 — Quest market의 반환 직전 가시성 재확인

- **근거:** `src/economy-service.ts:191`, `:196`, `:208`, `:209`. 각 task/project를 읽을 때 검사하지만 뒤의 다른 항목 읽기와 마지막 actor 검증을 거친 뒤 앞선 항목의 가시성을 다시 확인하지 않는다. 비교할 기존 패턴은 `src/explanation-service.ts:138`이다.
- **제안:** 실제 사용한 task/project 의존성만 관찰하고, 반환 직전에 현재 접근·숨김 상태를 검사한다. 이미 모은 제목·개수·cursor에도 동일하게 적용한다.
- **가치/주의:** 경제 데이터를 새로 합치는 작업이 아니라 조회 경계 보강이다. 프로세스 밖의 완전한 snapshot isolation까지 약속하지 않는다. 광범위한 전체 Vault observer는 피한다.
- **검증:** 뒤쪽 항목 읽기 또는 마지막 인증 확인 도중 앞선 task/project를 숨겼을 때 이전 제목·행·개수를 반환하지 않아야 한다.
- **확인:** 호출 전에 숨기면 제외되지만, 뒤쪽 task 읽기 또는 마지막 actor 검사 중 앞 task/project를 숨기면 이전 계약 제목과 `total:2`가 반환됐다. **서비스 경계에서 재현, 우선.** 노트 본문 유출이나 실제 NAS/HTTP 공격을 재현한 것은 아니다.

### R02 — 근거 위치 검사기의 의미를 하나로 통일

- **근거:** `src/llm-wiki.ts:546`은 heading/block을 원문 문자열에서 독립적으로 찾는다. `src/question-packet.ts:210`은 fence를 제외하고 block 유일성 및 heading/range 포함 관계를 검사한다. `src/source-change.ts:162`의 구간 비교는 line range 중심이다.
- **확인:** 코드 예제 안에만 있는 heading/block도 첫 검사에서는 통과했다. 실제 제목과 전혀 다른 줄 범위의 조합도 통과했다.
- **제안:** 제한된 공통 locator resolver로 heading/block/range/quoteHash를 함께 검증한다. 기존 한 구현을 무조건 정답으로 삼지 말고 들여쓰기·닫는 heading 표기·중복 block 등 지원 문법을 명시한다. 게시, lint, 답변 packet, 변경 영향 조회가 재사용한다.
- **가치/주의:** 증거 검사의 불일치를 제거하면서 heading/block 기반 영향 분석도 개선한다. body-relative 좌표와 frontmatter 포함 읽기 좌표는 구별한다. 구간 겹침은 의미상의 영향 판정이 아니다.
- **검증:** backtick/tilde fence, 중복 block, 잘못된 포함 관계, hash 불일치, 정상 heading/block/range 조합. **격리 재현, 우선.**

### R03 — Idea 분기를 한 번의 guarded creation으로 단순화

- **근거:** `src/ideation.ts:328`에서 부모를 먼저 확인한 뒤 일반 seed를 만들고, `:340`에서 `parent_ideas`를 추가 저장한다. 부모 revision은 마지막 저장의 related guard가 아니다. 분기에는 requestId도 없다.
- **확인:** 참조 검사 중 부모를 변경해도 생성됐다. 두 번째 저장 실패 시 `parent_ideas: []`인 자식이 남았다. 일반 references에 부모가 있어도 revision guard를 대신하지 못한다.
- **제안:** 부모 ID·revision·분기 관계를 초기 생성에 포함하고 기존 guarded write/public-create retry를 사용한다. 새 트랜잭션 엔진은 만들지 않는다.
- **검증:** 부모 drift면 자식 없음, 응답 유실 재시도는 동일 자식 한 개, requestId 재사용 시 payload 변경 거부, 현재 공개 참여 정책 유지. **격리 재현, 우선.**

### R04 — Work 페이지 fingerprint에 파생 검토 상태 포함

- **근거:** `src/work-service.ts:832`, `:874`; `src/work-model.ts:102`. 현재 review 상태를 행에 넣지만 cursor signature에는 그 상태가 없다.
- **확인:** 외부 근거 revision만 바꾸면 `review.current`는 true→false가 되지만 fingerprint는 그대로였다. 이전 coverage cursor로 재개할 때 한 행이 중복되고 앞쪽에 새로 추가된 stale 경고가 누락됐다.
- **제안:** 권한 내에서 계산한 최종 행 또는 의미 있는 review-state fingerprint를 페이지 서명에 포함한다. 항목 수가 변하지 않는 board도 동일 snapshot 원칙을 적용한다.
- **검증:** 외부 근거만 변경해도 옛 cursor 거부, 무변경이면 재개 허용, 숨긴 근거의 정체·개수 비노출.
- **경계:** 새로운 읽기는 검토 상태를 재계산하고, 완료 mutation에는 별도 승인 검사가 있다. **권한 우회가 아니라 mixed-snapshot pagination 문제로 재현됨. 우선.**

### R05 — Idea 평가를 평가 대상 revision에 고정

- **근거:** `src/ideation.ts:417`은 대상 존재를 확인하지만 평가된 Idea revision을 저장하지 않는다. `:318`의 평가 목록에는 평가 노트 path/revision/freshness가 없다.
- **제안:** evaluated-source revision을 저장·최종 guard하고 평가 locator와 stale/unpinned 상태를 반환한다. 기존 미고정 평가는 역사 기록으로 유지한다.
- **가치:** 원안 변경 전 점수가 새 원안의 평가처럼 사용되는 것을 막고 평가 갱신에 필요한 정확한 revision을 제공한다. 점수는 계속 자문 신호다.
- **검증:** 저장 직전 대상 변경 거부, 이후 변경 시 stale, 반환 locator로 평가 수정 가능. **정적 확인, 우선.**

### R06 — WikiLink 읽기의 별도 구형 계약을 bounded read로 연결

- **근거:** `src/createServer.ts:1222`, `:3352`; `src/wikilink/wikiLinkTool.ts:23`; `src/filesystem.ts:896`. 현재 계약은 fragment를 무시하고 중복 basename 중 첫 파일을 선택하며 전체 내용을 읽는다.
- **확인:** 내부에서 50,041자 결과를 만들고 최종 공통 compactor가 52자 `{truncated,maxChars,path}`로 바꾸는 경우, revision과 이어 읽기가 없다. 최종 전송이 무제한이라는 주장은 아니다.
- **제안:** 링크 해석을 locator 생성으로 제한하고 기존 bounded note/section/block 읽기를 재사용한다. 모호하면 후보 선택을 요구하는 모드를 제공한다. 기존 fragment 무시/첫 후보 선택은 문서화된 동작이므로 명시적 전환 절차가 필요하다.
- **검증:** 큰 문서 I/O 상한, continuation·revision, heading/block 보존, 중복 이름, 숨긴 후보, 마지막 읽기 중 접근 변경. **헬퍼/compactor 재현; 계약 전환 후보.**

### R07 — 중복 탐지를 metadata-first로 바꾸고 stable ID를 후보 키로 사용

- **근거:** `src/llm-wiki.ts:4086`은 모든 접근 가능한 노트를 body 포함 조회한 뒤 지식 종류를 거른다. `:4096` 후보 bucket에는 제목·alias·단어만 있고 `:4117`에서 뒤늦게 stable ID를 비교한다.
- **확인:** 같은 stable ID를 가진 Astronomy/Cookery 제목 쌍이 누락된다. 공통 alias를 넣으면 같은 ID 점수가 정상 작동한다.
- **제안:** metadata bucket에 stable ID를 포함하고 후보 쌍만 제한적으로 hydration한다. 결과 범위가 제한되면 partial임을 표시한다.
- **검증:** 서로 다른 제목/동일 ID, 숨긴 후보, hydration 도중 drift, body-read 상한. 자동 merge는 금지한다. **격리 재현; 누락 개선과 I/O 최적화 후보. 속도 개선량은 미측정.**

### R08 — 원격 연결만 하는 PC에서 로컬 서버 경로 요구 제거

- **근거:** `scripts/mcpvault-setup.mjs:93`, `:152`. `connect-existing-server`의 `remote-https`도 program/Vault/private-state/client 경로를 모두 검증한다.
- **확인:** 네트워크를 호출하지 않는 planSetup에서도 로컬 program/Vault를 생략하면 실패한다. build가 없어도 되는 것과 로컬 Vault 자체가 필요 없는 것은 다르다.
- **제안:** 연결-only는 endpoint와 client/private-state만 요구하고, 로컬 stdio/새 서버 설치만 실제 program/Vault를 요구하도록 recipe를 분리한다. manifest와 확인 fingerprint의 버전 호환도 정의한다.
- **검증:** 서버 디렉터리 없는 PC의 preview/apply/import, HTTPS·백업·권한·소유권·확인 후 drift 보호 유지. native 3 OS 실행은 실제 runner에서 별도 확인한다. **정적+입력 재현, 우선 사용성 개선.**

### R09 — 벤치마크의 제출 마감과 정산 종료를 분리

- **근거:** `src/benchmark-service.ts:254`는 마감 이후 decision/전체 지급 완료 확인 없이 예약을 닫을 수 있다. 동료 검토는 마감 뒤 이루어진다. `src/economy-model.ts:201`은 닫힌 프로그램의 새로운 지급을 거부한다.
- **제안:** 정상 close는 판정 완료 및 모든 수상자의 durable award receipt를 확인하도록 한다. 포기는 이유가 있는 별도 human cancellation로 명확히 구별한다. 기존 decision/ledger에서 도출할 수 있는 상태를 별도 DB에 복제하지 않는다.
- **가치/주의:** 미완료 검토나 부분 지급 복구를 운영자가 정상 종료로 막는 실수를 줄인다. 현재 동작은 호스트에게 허용된 정책이므로 권한 우회가 아니다. 취소 허용 시점과 기지급 XP 보존은 별도 합의가 필요하다.
- **검증:** 심사 중·부분 지급 상태에서 정상 close 거부, 0명 수상·모두 지급 완료 종료, 재시도 중복 지급 없음. **정적 확인; 운영 정책 선택.**

## B. 범위를 좁힌 최적화·일반화·유사 개념 병합

### R10 — 상황 조건으로 활성화된 후보의 최소 슬롯 확보

- `src/context-selection.ts:38`, `:47`: 조건 일치 후보가 있어도 일반 결과가 12개이면 추가되지 않는다. 실제 selector로 재현했다.
- 같은 12칸 안에서 작은 quota/interleave를 두거나 미포함 상태를 bounded 진단으로 반환한다. 기존 근거·반례 관계용 8칸과 body-read 상한을 유지한다.
- 단순 점수 경쟁으로 안전상 주의사항을 밀어내거나 조건을 새 실행 명령으로 해석하지 않는다. 12개 일반 결과 + 늦게 정렬되는 조건 전용 노트 회귀 테스트가 필요하다.

### R11 — document discovery의 resource 창에도 continuation 추가

- `src/document-search.ts:28`, `:34`: 검색 hit 24개와 정렬된 resource 앞 32개의 합집합을 최대 48개로 제한한다. 현재 cursor는 이 창 안의 fragment를 넘긴다.
- 확인된 누락 조건은 **앞 32개 밖의 resource이며 retrieval hit에도 없고 직접 path도 제공하지 않은 경우**다. hit/direct path가 있으면 현재도 찾는다. 기존 partial 표시는 정직하므로 false-completeness 문제로 부르지 않는다.
- resource 창을 catalog generation에 고정해 계속 탐색하게 한다. fragment cursor와 혼동하지 않고 현재 I/O·ACL·최종 source guard를 유지한다. 새 전체본문 인덱스부터 만들 필요는 없다.

### R12 — semantic fallback deadline을 대기 중 추론 취소와 연결

- `src/retrieval-service.ts:161`은 2초 후 optional 결과를 기다리지 않는다. `src/semantic-search.ts:1199`의 gate는 서비스 종료 signal만 받고, `src/semantic-inference-gate.ts:24`의 대기 한도는 5초다.
- 대기 작업에 request deadline을 전파하여 이미 버린 요청이 나중에 native 추론을 시작하지 않게 한다. `src/semantic-search.ts:1232`의 동일 query 공유 작업은 살아 있는 다른 subscriber가 있으면 유지한다.
- 진행 중 native 작업의 slot을 강제 반환하면 안 된다. 검증 기준은 expired queued job의 embedder 호출 0회, 정상 subscriber 성공, 기존 foreground/background fairness 보존이다. **정적 경로 확인; 실제 비용·지연 개선은 측정 필요.**

### R13 — endpoint operation 계약의 중복 정의 축소

- `src/createServer.ts:271`, `:314`, `:1438`의 mutation/capability/read alias와 `src/endpoint-registry.ts:721`의 availability 분기는 같은 operation 의미를 여러 곳에 표현한다. Story에는 이미 `STORY_OPERATIONS`라는 부분적 선례가 있다.
- 기존 registry에 typed operation descriptor를 점진적으로 넣고 discovery·alias·read-only 목록 및 계약 테스트를 도출한다. 새 plugin framework나 범용 업무 엔진은 만들지 않는다.
- service의 최종 인증·ACL·revision·도메인 검증은 삭제하지 않는다. 공통 descriptor는 발견/라우팅 계약의 원천이지 실제 접근 허가의 대체물이 아니다.
- anonymous/authenticated × read-only/writable × host configured/unconfigured × operation 매트릭스로 기존 다섯 MCP 도구와 동작을 보존해야 한다. **구조적 개선; 현재 권한 결함을 입증했다는 뜻은 아님.**

### R14 — 해설의 수행 가능 여부와 추천 우선순위 분리

- `src/explanation-service.ts:201`, `:292`는 read continuation과 Pulse 후보를 각각 계산한다. status·작성자·profile basis의 중복과 Gemini 선호/WIP라는 의도적 차이가 섞인다.
- 순수 eligibility 판정만 공유하고 추천 순위는 별도로 둔다. 명시적 read 가능 여부와 자동 추천 여부를 같은 boolean으로 합치지 않는다.
- 기존 작업 이어가기, 교차 계열 reviewer 대기, WIP, profile drift, voluntary 특성의 상태 매트릭스를 유지한다. 모델 자동 호출은 추가하지 않는다.

### R15 — Roleplay 확장의 작은 공통 kernel 추출

- `src/roleplay-model.ts:3`, `src/roleplay-trpg.ts:3`, `src/roleplay-evolution-model.ts:1`: root가 확장을 import하고 확장은 hash/validator 때문에 root를 runtime import한다. compiled import graph에서 확인했다.
- `roleplayHash`, `roleplayRevision`, `roleplayId`, `roleplayAccount`, `roleplayText`만 추출한다. root re-export를 유지하고 확장은 값은 kernel, state는 type-only로 참조한다.
- persisted hash의 key sorting·array 순서·JSON omission·requests 제외와 validator 의미를 그대로 유지한다. reducer·state 전체를 재설계하지 않는다. 현재 초기화 장애는 발견하지 않았다.

### R16 — 선택 전에도 도달 불가능한 구성 가지 진단

- `src/capability-graph.ts:23`, `:39`, `:72`: reference/cycle과 현재 선택은 검사하지만 미선택 노드의 prerequisite closure가 exclusion과 모순인지는 알려주지 않는다.
- 실제 checker에서 `requires:[base]`, `excludes:[base]`인 미선택 가지가 있는 구성도 현재 선택 `[]`는 valid였다. 현재 선택 자체는 모순이 없으므로 valid를 무조건 오류라고 부르지 않는다.
- bounded advisory 진단으로 직접/전이 모순을 보여준다. TRPG 트리·학습 경로·절차 묶음에 함께 재사용할 수 있다. 새 ruleset 검토 시 이 진단을 **기능 가지치기** 근거로 쓴다.
- 기존 합법적 배타 대안과 현재 ruleset을 자동 제거하지 않는다. hard rejection으로 전환하려면 버전 정책이 필요하다.

### R17 — Continuity의 검증 범위를 필드별로 명시

- `src/continuity.ts:478`, `:496`: learning progress/understanding은 검사하지만 pending edits/research trail은 역사 기록으로 반환한다. route reason은 포괄적으로 보일 수 있다.
- `checked/unchecked` 범위를 작은 projection으로 표시하고 선택한 pending/trail pin의 검증만 명시적으로 요청할 수 있게 한다.
- 저장된 edit guard를 새 revision으로 자동 바꾸거나 pending action을 실행하지 않는다. 새 checkpoint DB도 만들지 않는다. 검증한 understanding과 오래된 pending edit가 동시에 있을 때 혼동하지 않는 것이 수용 기준이다.

## C. 추가할 가치가 있는 작은 연결·분기

이 절은 결함 수정이 아니라 선택할 수 있는 제품 확장이다. 모두 명시적 요청, 현재 권한, 정확한 근거 pin을 전제로 한다.

| ID | 연결 | 가장 작은 유용한 형태 | 반드시 유지할 경계 |
| --- | --- | --- | --- |
| R18 | 원문 읽기 ↔ 검증된 해설 | 원문/학습 packet에 opt-in `explanationAction`을 제공하고 선택했을 때만 읽기 | 원문 대체 금지, 승인/current source/profile/ACL 재검사, draft 비공개 |
| R19 | 구성 그래프 ↔ 실제 학습 경로 ↔ Continuity | `configuration.check`의 node를 revision-pinned MOC/note에 매핑한 preview, 선택 진행의 checkpoint 저장 | 배웠다는 선언을 능력 인증·실행 권한으로 승격하지 않음 |
| R20 | Workshop ↔ 독립 연구 이어하기 | 이미 아는 Workshop 안에서 자신에게 허용된 round ID·phase·revision·status action만 paged 조회 | 비공개 참가자/답안/round 총수 누출 금지, 닫힌 parent의 합법적 cleanup 접근 유지 |
| R21 | 장기 Work/Story ↔ 과거 Skill 버전 경험 | 보존된 v1을 실제 사용한 작업이 v2 승격 뒤 끝나도 historical feedback 기록 | 현재 v2 후보/승격 근거에 자동 혼합하지 않음, shareable 승인 필요 |
| R22 | 벤치마크 ↔ Skill 개선·지식 반례 | 종료된 결과 중 사용자가 공개 승인한 평가 근거만 experience/후보 입력으로 연결 | 정답·봉인 답안 비노출, 모델 보편 순위나 도구 권한으로 전환 금지, 자동 승격·재지급 없음 |
| R23 | TRPG 확정 턴 ↔ Story 초안/분기 | 선택한 확정 턴을 exact revision으로 참조하는 허구 창작 초안 제안 | 현재 room ACL, fictional 표시, replay/dice 원장 불변, 자동 publish/XP 없음 |

근거와 구현 출발점:

- R18: `src/explanation-service.ts:208`은 sourceAction과 승인 route를 이미 제공한다. `src/createServer.ts:714`에는 Pulse 연결이 있다. 기존 기능을 없다고 하지 않고 일반 지식/학습 읽기에서 **선택적 진입점**을 보완한다.
- R19: `src/configuration-tools.ts:5`, `:22`는 supplied data만 검사하며 파일·실제 경로를 읽지 않는다. 현재 자유 입력 검증을 그대로 유지하고 별도 명시적 preview 경로에서만 매핑한다.
- R20: `src/independent-research-tools.ts:13`은 모든 읽기에 roundId를 요구한다. `docs/independent-research.md:26`의 초대 ID 보관이 지금의 복구 경로다. 일반 공개 목록을 만들자는 제안이 아니다.
- R21: `src/skill-evolution.ts:181`은 현재 버전이 아닌 경험을 거부하며 private 보관을 안내한다. `:205`의 후보 basis 검사도 유지한다. 따라서 이 항목은 의도된 정책의 선택적 확장이다.
- R22: `src/benchmark-service.ts:16`의 private entry/decision과 `src/skill-evolution.ts:182`의 evidence 경계 사이에 공개 승인된 얇은 참조 adapter를 둔다. private benchmark 노트를 일반 Skill evidence로 직접 넘기지 않는다.
- R23: `src/roleplay-model.ts:23`의 receipt, `src/roleplay-trpg-projections.ts:76`의 fictional projection, `src/story-artifacts.ts:17`의 guarded artifact 경로를 재사용한다. 새로운 게임/창작 공용 writer는 만들지 않는다.

추천 순서는 R20·R18처럼 **이미 있는 작업을 다시 찾고 읽는 연결**부터다. R22·R23은 개인정보·공개 범위·편집 책임의 설계가 더 필요하다.

## D. 제거·간략화할 부분과 제거하면 안 되는 부분

### R24 — 호스트 자료를 매번 수동으로 Git에서 제외하는 위험 줄이기

- `AGENTS.md:180`은 `.agents/`, `.mcpvault/`, credentials/caches를 커밋하지 말라고 한다. 현재 `.gitignore:124`에는 `.codex/`가 있지만 앞의 두 디렉터리와 Python cache 제외 규칙은 없다.
- `git ls-files`로 해당 경로가 현재 추적되지 않는 것은 확인했다. 노출 또는 유출이 있었다는 뜻은 아니다.
- 제안: 명시적인 ignore와 staged-path 검사로 규칙을 기계적으로 보강한다. 기존 호스트 자료·rollback stage·세계/경제 checkpoint를 삭제하는 작업과는 구별한다.

### R25 — 사용자 운영 문서의 작업자 단계 기록 정리

- `docs/benchmark-challenges.md:370` 이후에는 worker/parent별 중간 테스트·인계 기록이 운영 안내와 함께 있다. 최종 deployment 증거의 위치를 구별하고 있어 거짓 완료 기록은 아니다.
- 운영 안내에는 실제 사용법·승인·제한을 남기고, 중간 검증 이력은 기존 execution record로 모은 뒤 링크한다. 역사적 증거를 버리는 것이 아니라 중복 서술을 줄인다.

### 실제 코드 dead pruning 판단

현재 조사로 **모듈 전체를 즉시 삭제할 충분한 근거는 찾지 못했다**. 파일명/참조 수만으로 판단하지 않고 entrypoint·script·export·테스트도 대조했다. 이 검사는 모든 함수의 도달 가능성을 수학적으로 증명한 것은 아니다.

삭제/통합 가능한 범위는 먼저 다음으로 한정하는 것이 좋다.

1. R02의 여러 locator 검사기: 공통 계약·회귀 테스트로 대체한 뒤 중복 구현 제거.
2. R03의 두 번째 child 저장: 초기 guarded creation으로 대체한 뒤 제거.
3. R13의 중복 read alias/mutation/capability 분기: operation descriptor로 대체된 부분만 제거.
4. R14의 중복 continuation eligibility: 의도적으로 다른 추천 정책을 남기고 중복만 제거.
5. R06의 별도 전체본문 응답 조립: 호환 계약 전환 후 canonical bounded reader로 대체.
6. R16의 도달 불가능한 기능 가지: 현재 규칙/문서를 자동 삭제하지 않고 새 버전 편집 preview의 후보로 제공.

반대로 다음은 유지한다.

- **해설 승인 / Work 승인 / Story 편집 결정 / 벤치마크 평가:** 같은 “검토”라도 판정 대상·독립성·효과가 다르다. source pin 등의 구조만 공유한다.
- **사회적 평판 / 지갑 XP / TRPG 성장:** 교환 가능한 한 점수로 합치지 않는다.
- **Layered Memory / Continuity / 불변 Source:** 경험 회상, 작업 복귀, 근거 원본은 별개다. 두 번째 memory DB나 자동 consolidation authority를 추가하지 않는다.
- **Global sync / public federation / enterprise SharedMemory:** 모두 동기화처럼 보여도 공개 범위와 신뢰 모델이 다르다.
- **Story의 lazy import cycle:** `story-artifacts.ts:67`의 visual 검증과 `story-visual.ts:185`의 기존 writer 재사용이다. 현재 무한 재귀를 의미하지 않는다. cycle 수를 줄이려고 별도 writer를 만들면 오히려 guard가 갈라진다.
- **host utility, recovery, export/projection, 비활성 선택 기능:** 실제 script 소비자가 있거나 실패 시 복구 역할이 있다. 비활성은 dead와 동의어가 아니다.
- **생성 guidance 및 최종 service guards:** 줄 수 감소를 위해 편집 가능한 안내나 방어 검사를 통째로 없애지 않는다.

## E. 이미 개선되어 이번 신규 목록에서 제외한 것

이전 실행 기록 `docs/research/2026-09-10-complexity-refinement.md`, `docs/plans/2026-09-10-cross-axis-reliability.md`를 현재 소스와 대조했다.

- Pulse의 모든 하위 소스 eager 조회: 이미 단계별 조회와 coverage 구분이 있다. 새 scheduler로 대체할 필요 없다.
- 다섯 도구와 동적 기능 검색·catalog continuation: 이미 있다. 전체 catalog를 매번 preload하는 설계를 추가하지 않는다.
- Work에 연결된 기존 task의 중복 추천, Story writer 인계 복구, Story/Quest 결과의 Work 연결: 이미 구현되어 있다.
- Workshop 산출물 caveat 전달, 닫힌 Workshop의 합법적인 독립 연구 cleanup: 이미 보강되었다.
- fiction-domain 검색 차단과 현재 선택 hit의 검증: 이미 있다. 검색 전체 metadata 사전 hydration을 다시 도입하지 않는다.
- Memory의 교정 이력과 source-basis 확인, 벤치마크 exact numeric 비교, 해설 profile pin, TRPG receipt room 재검증: 새 결함 증거 없이 재구현 대상으로 삼지 않는다.

## F. 선택 가능한 추진 방식

| 방식 | 이점 | 비용/위험 | 판단 |
| --- | --- | --- | --- |
| 기능 연결부터 확장 | 눈에 보이는 새 사용 사례가 빠름 | 현재 경계 결함과 계약 중복이 확산됨 | 지금은 비추천 |
| 작은 경계 보강 → 공통 구조 → 선택적 연결 | 기존 기능 보존, 회귀 범위 명확, 추가 복잡도 제한 | 여러 작은 검증 단위가 필요 | **추천** |
| 통합 workflow/agent/graph 플랫폼 재작성 | 일관된 표면을 만들 가능성 | 권한·검토·정산 의미를 잘못 합칠 위험, 큰 migration | 현재 근거로 정당화되지 않음 |

추천 구현 단위(승인이 있을 때만):

1. **근거·가시성·일관성:** R01–R05. 각 문제의 RED 회귀와 현재 접근·revision·hidden-count 검증부터.
2. **읽기와 연결 UX:** R06–R08, R10–R11. I/O·응답 예산 및 계속 탐색을 함께 검증.
3. **정산 운영 정책:** R09. 정상 종료와 명시 취소를 먼저 합의하고 ledger fixture로 검증.
4. **작은 공통화와 비용 절감:** R12–R17. 변경 전후 호출 수·대기 추론 시작 수·반환 계약을 측정한다. 파일 분할/줄 수만을 성과로 삼지 않는다.
5. **선별된 연결:** R18/R20부터 필요에 따라 선택. R19/R21/R22/R23은 데이터·공개·정책 경계를 확정한 뒤 진행.
6. **저위험 정리:** R24/R25는 독립적으로 시행 가능하나 이번 조사에서는 적용하지 않는다.

새 Enterprise 선택 기능 지원은 이번에 자동 확장 대상으로 넣지 않았다. `src/enterprise-server.ts:21`, `:350`의 별도 host 계약과 정상 서버의 기능 차이가 이미 문서화되어 있다. 공통 descriptor를 도입하더라도 미지원 기능을 자동 활성화하지 않는다.

## 최종 조사 상태

R01은 실제 EconomyService와 메모리 경계에서 visible baseline, 호출 전 숨김, 뒤쪽 읽기 중 숨김, 마지막 actor 검사 중 숨김 및 project 숨김을 포함한 6개 단언으로 추가 확인했다. 실제 파일 알림·HTTP·cross-process timing은 미검증이다.

이번에 작성한 산출물은 이 조사 문서 한 개다. 기존 추적 소스는 변경하지 않았고 기존 미추적 운영·연구 자료도 보존했다. 제안의 구현·승인·배포·커밋·푸시는 하지 않았다.
