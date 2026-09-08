# MCPVault 연구일지·연구노트 강화: 기법, 논문, 도구 조사

조사일: 2026-09-08 (Asia/Seoul). 상태: 조사 및 개선 후보이며 구현 사양은 아니다.

핵심 제안은 **질문 → 조사 → 시도 → 관찰 → 해석 → 판단 변경 → 다음 연구**를 원본과 함께 따라갈 수 있게 만드는 것이다. 시간순 연구일지, 실행별 실험 기록, 출처별 문헌노트, 재사용할 지식 노트를 연결하되 같은 내용을 매번 복제하지 않는다.

## 조사 범위와 근거의 성격

- 연구 기록·계산 재현성·문헌 검색·출처·지식 정리를 대상으로 논문, 저자 공개 원문, 공식 규격과 제품 문서를 검색했다. 체계적 문헌고찰이나 모든 제품의 비교 평가는 아니다.
- 주요 검색어: `computational laboratory notebook`, `reproducible computational research`, `exploration explanation computational notebooks`, `preregistration`, `PRISMA-S`, `FAIR`, `PROV`, `RO-Crate`, `evergreen notes`, `multiverse analysis`.
- 채택 기준: 프로젝트의 Markdown/Git 기반 기록에 옮길 수 있는 구체적 원칙이 있고, 논문 또는 공식 자료로 확인할 수 있을 것. 서비스 가격, 인기 순위, 법적 효력은 평가하지 않았다.
- 논문의 실증 관찰, 방법론 제안, 실무 권고, 제품 기능 설명은 서로 다른 종류의 근거다. 아래 **적용 제안**은 조사자의 설계 판단이며 MCPVault에서 효과가 검증된 결과가 아니다.
- 일부 논문은 초록·관련 절 중심으로 확인했다. 검색 엔진의 수집일을 출판일로 사용하지 않았다. PNAS 원문 페이지의 접근 제한은 PMC에 공개된 같은 논문으로 보완했다.

## 1. 현재 프로젝트에서 확인한 기반

확인 시 HEAD: `212fd80e07cff76ba7daf2b1de8c358bfc18a5ca`. 작업 중인 공유 체크아웃의 문서와 관련 코드를 읽은 시점의 관찰이며, 전체 기능 감사나 테스트 실행 결과는 아니다.

| 확인된 기반 | 근거 | 이번 조사에서의 의미 |
| --- | --- | --- |
| question / hypothesis / experiment / assumption 구분, `tests`, 실패·불확정 결과 보존 | [README](E:/dev/llm_wiki/README.md:332) | 실험 타입을 새로 만드는 것보다 실제 작성 흐름 개선이 먼저다 |
| 사전 질문·대안·판정 기준, 저장된 계획 revision에 결과 연결 | [investigation 설명](E:/dev/llm_wiki/docs/knowledge-investigation.md:1), [검증 코드](E:/dev/llm_wiki/src/knowledge-investigation.ts:33) | 결과와 동시에 기준을 바꾸지 못하는 기반이 이미 있다 |
| 조건별 설명·반례·미해결 질문을 보존하는 종합 | [synthesis 설명](E:/dev/llm_wiki/docs/knowledge-synthesis.md:1) | 지식 종합을 단일 승자나 무조건적 결론으로 만들 필요가 없다 |
| 원본 연구와 재인용·재출판의 계보 구분 | [source provenance](E:/dev/llm_wiki/docs/source-provenance.md:1) | 여러 요약이나 에이전트 동의를 독립 증거로 세지 않는 기반이 있다 |
| 문헌·실험 노트의 작성 구조 검사 | [README](E:/dev/llm_wiki/README.md:1400) | 양식 완성도와 과학적 타당성·실제 재현 성공을 분리해야 한다 |

연결된 Wiki의 제한된 `wiki.answer_packet` 검색은 이 주제의 검증된 불변 근거를 반환하지 않았다. 검색 결과는 partial이므로 관련 지식의 부재를 뜻하지 않는다. 따라서 외부 자료와 저장소의 직접 확인을 주된 근거로 삼았다.

동시 작업 범위: `llm_wiki`는 기억·일지 구현, `llm_wiki2`는 커뮤니티 지속 참여 조사·계획을 담당한다. 이 문서는 연구 기록의 품질·재현성·문헌 정리 측면을 다루며 공통 코드나 그 두 세션의 문서를 수정하지 않는다.

## 2. 참고할 기법과 용어

### 2.1 연구일지와 지식 노트를 연결하기

**ELN (Electronic Lab Notebook), chronological research log**: 날짜·주제·활동과 결과가 만들어진 과정을 기록한다. Schnell의 논문은 계산 연구에서도 실험뿐 아니라 연구 활동과 맥락을 일지에 남기도록 권고한다. 이는 기록 실무 지침이며 특정 앱의 효과 실험은 아니다. [Schnell, 2015](https://journals.plos.org/ploscompbiol/article?id=10.1371/journal.pcbi.1004385)

**적용 제안:** 세션마다 `오늘의 질문 / 실제 한 일 / 관찰한 사실 / 해석과 판단 / 다음 행동`을 짧게 남긴다. 과거 기록을 현재의 정답에 맞춰 고쳐 쓰기보다 정정과 후속 노트를 연결한다. 개인 기억의 공개 여부는 원래 scope를 따른다.

**Exploration vs. explanation, computational narrative**: 연구 중의 자유로운 시도와 남에게 설명할 문서는 목적이 다르다. Rule 등의 CHI 연구는 계산 노트북 사용에서 이 긴장을 관찰했다. 정리된 결과 문서가 탐색 중의 선택과 실패를 모두 보여주지는 않는다. [Rule, Tabard & Hollan, 2018](https://adamrule.com/files/papers/chi_2018.pdf)

**적용 제안:** 간단한 탐색 일지를 즉시 남기고, 의미 있는 구간이 끝나면 실험·지식 노트로 정리한다. 원본 기록을 보존한 채 독자용 요약을 연결한다. 모든 짧은 메모를 출판 가능한 문서로 만들도록 요구하지 않는다.

### 2.2 문헌노트에서 개념 지식으로 발전시키기

**Zettelkasten, atomic notes, evergreen notes**: 문헌이나 프로젝트별 보관만으로 끝내지 않고 개념 단위로 노트를 연결한다. 루만 아카이브는 실제 카드와 연결 구조를 보여주며, Andy Matuschak은 원자성과 개념 중심 작성을 설명한다. 이는 참고할 사고·작성 기법이지 LLM 연구 생산성 향상의 실험적 보증은 아니다. [루만 아카이브](https://niklas-luhmann-archiv.de/nachlass/zettelkasten), [atomic notes](https://notes.andymatuschak.org/Evergreen_notes_should_be_atomic), [concept-oriented notes](https://notes.andymatuschak.org/Evergreen_notes_should_be_concept-oriented)

**적용 제안:** `논문 A 요약`에는 논문의 질문·방법·주장·한계를, `조건 C에서 기법 X가 유리하다`에는 여러 근거를 연결한 해석을 둔다. 각 노트는 필요한 조건과 반례를 설명할 만큼 충분한 크기를 유지한다. 모든 문장을 별도 파일로 분해하지 않는다.

**Source annotation / literature note / evidence matrix**: 원문 표시, 자기 해석, 주장별 근거 비교를 구별한다. Zotero는 주석을 노트에 넣을 때 인용과 PDF 페이지로 돌아가는 링크를 제공한다. [Zotero 공식 문서](https://www.zotero.org/support/pdf_reader)

**적용 제안:** 문헌노트에 `원문 위치 / 저자의 주장 / 내가 이해한 의미 / 적용 조건 / 반례·한계 / 읽은 범위`를 둔다. 기존 `wiki.claim_matrix`로 주장과 증거를 비교하고, 출처 URL만 있는 요약과 본문을 읽은 해석을 구분한다.

### 2.3 탐색과 검증을 구분하기

**Preregistration, exploratory / confirmatory analysis**: 결과를 보기 전에 질문과 분석 계획을 기록해 사전 예측과 사후 설명을 구별한다. 탐색 연구를 금지하는 기법은 아니다. [Nosek et al., 2018](https://pmc.ncbi.nlm.nih.gov/articles/PMC5856500/)

**적용 제안:** 기존 `knowledge_investigation`의 대안·판정 기준·`planRevision`을 활용한다. 이미 결과를 본 뒤 만든 계획은 탐색·사후 해석임을 명시한다. 로컬 Git revision이나 저장 순서만으로 외부 검증 가능한 사전등록이 성립한다고 부르지 않는다. 결과를 보기 전에 저장했는지는 기록 구조만으로 모두 입증할 수 없다.

**Registered Reports**는 학술지에서 결과를 알기 전 연구 질문과 방법을 심사하는 출판 절차로, 단순 사전등록과 다르다. 연구의 가치가 유의한 결과에만 달리지 않게 하는 참고 사례다. MCPVault의 동료 계획 검토를 이 공식 출판 절차와 동일시하지 않는다. [COS 공식 설명](https://www.cos.io/initiatives/registered-reports)

**Negative results / inconclusive results / failed runs**: 가설을 지지하지 않는 관찰, 결론을 내릴 수 없는 관찰, 실행 자체의 실패는 다르다. 기존 실험 상태와 결과 판정은 이 구분을 담을 기반이 있다. 연구 과정을 남기라는 계산 노트북 지침도 막다른 경로의 보존을 강조한다. [Rule et al., 2019](https://journals.plos.org/ploscompbiol/article?id=10.1371/journal.pcbi.1007007)

**적용 제안:** `프로그램 오류로 실행 중단`을 가설 반증으로 승격하지 않는다. 실패에서 일반화할 교훈이 있을 때만 조건을 붙인 negative-knowledge 노트를 만든다. 비유의한 관찰만으로 효과가 없다고 단정하지 않는다.

### 2.4 결과를 다시 만들 수 있게 기록하기

**Computational reproducibility, run manifest, artifact lineage**: 결과를 만든 입력·프로그램 버전·파라미터·전처리와 실행 순서를 추적한다. Sandve 등의 권고는 원시 데이터에서 결과까지 이어지는 과정을 대상으로 한다. [Sandve et al., 2013](https://journals.plos.org/ploscompbiol/article?id=10.1371/journal.pcbi.1003285)

**적용 제안:** 실험 노트에서 정확한 데이터 식별자/해시, 코드 commit과 미커밋 패치 여부, 설정, seed, 환경, 실행 명령, 로그·결과물 위치를 연결한다. 결과 파일은 필요에 따라 외부 저장소에 두고 Vault에는 참조를 둔다. 실행 명령이 기록되어 있다는 사실은 실행 성공의 증거와 다르다.

**ML reproducibility checklist**: Pineau 등의 보고는 NeurIPS 2019의 코드 제출·재현 챌린지·체크리스트 운영을 설명한다. MCPVault의 모든 연구 유형에 동일한 필드를 강제하기보다 ML 실험용 선택 양식의 참고 자료로 적합하다. [Pineau et al., 2021](https://jmlr.org/papers/v22/20-303.html)

**LLM 연구용 적용 제안:** 공급자·모델 식별자, 호출 시각, 공개 가능한 프롬프트/템플릿 버전, 추론 설정, 도구 버전, 평가 데이터와 평가자 버전, 반복 횟수·분산·비용을 기록한다. 이는 논문의 원문 체크리스트를 그대로 옮긴 것이 아니라 프로젝트 특성에 맞춘 확장안이다. 기록은 공개 가능한 입력·출력과 관찰 근거를 대상으로 하며 비밀 키나 내부 비공개 추론은 담지 않는다. 모델 API와 환경 변화 때문에 동일 seed만으로 동일 출력을 약속하지 않는다.

**Sensitivity analysis / multiverse analysis**: 합리적인 전처리·분석 선택을 달리했을 때 결론이 얼마나 바뀌는지 살핀다. Steegen 등의 논문은 데이터 처리 선택의 여러 조합을 비교하는 방법을 제시한다. [Steegen et al., 2016](https://stat.columbia.edu/~gelman/research/published/multiverse_published.pdf)

**적용 제안:** 같은 질문의 실험들을 바꾼 조건·고정 조건·관찰된 차이로 묶는다. LLM 프롬프트·모델·평가 방식 비교로 확장할 때는 적용상의 유추라고 표시한다. 일부 조건만 살핀 결과를 모든 합리적 선택을 포괄한 분석이라고 부르지 않는다. 단순 제거 실험인 ablation과 multiverse는 같은 용어가 아니다.

### 2.5 조사와 출처를 다시 추적하기

**Search log, PRISMA-S, inclusion/exclusion criteria**: PRISMA-S는 체계적 문헌고찰의 검색 보고를 위한 지침이다. 정보원, 검색식, 시점, 제한과 검색 결과 처리 등을 보고해 조사 경로를 명확히 한다. [Rethlefsen et al., 2021](https://link.springer.com/article/10.1186/s13643-020-01542-z)

**적용 제안:** 일반 조사에도 `질문 / 검색한 곳 / 실제 검색식 / 검색일 / 채택·제외 이유 / 읽은 범위 / 아직 못 찾은 것`을 가볍게 남긴다. 일반 웹 조사에 전체 체계적 문헌고찰 절차를 강제하거나 PRISMA 준수를 주장하지 않는다. 확인하지 않은 결과 수를 만들어 채우지 않는다.

**Provenance, entity–activity–agent**: W3C PROV는 무엇이 어떤 활동으로 누구에 의해 만들어졌는지 표현하는 공통 개념을 제공한다. [W3C PROV Primer](https://www.w3.org/TR/prov-primer/)

**적용 제안:** 논문·데이터·실험 산출물은 entity, 분석·검토는 activity, 연구자·실행 주체는 agent에 대응시켜 기존 출처·실험 관계의 의미를 점검한다. 전체 RDF 저장소를 새로 도입할 필요는 없다. 출처 계보와 독립적인 재현 여부는 별도로 확인한다.

**FAIR, Research Object, RO-Crate**: FAIR는 찾기·접근·상호운용·재사용을 위한 원칙이고, RO-Crate는 연구 데이터·소프트웨어·맥락 메타데이터를 연결해 묶는 구현 방식이다. FAIR는 무조건 공개하라는 뜻이 아니며 인증과 접근 제어를 허용한다. [Wilkinson et al., 2016](https://www.nature.com/articles/sdata201618), [RO-Crate 1.2 소개](https://www.researchobject.org/ro-crate/specification/1.2/introduction.html)

**적용 제안:** 완료된 연구 묶음의 Markdown 노트, 인용, 데이터·코드·환경·결과 참조를 내보내는 방향에 참고한다. 내부 Markdown을 권위 있는 원본으로 유지하고 필요할 때 교환용 manifest를 생성한다. 비공개 원본이나 그 메타데이터가 자동으로 공개되지 않도록 내보내기 범위를 검사해야 한다.

## 3. 먼저 읽을 논문

| 순서 | 논문 | 근거 성격과 읽을 초점 |
| --- | --- | --- |
| 1 | Schnell (2015), [Ten Simple Rules for a Computational Biologist’s Laboratory Notebook](https://journals.plos.org/ploscompbiol/article?id=10.1371/journal.pcbi.1004385) | 실무 권고. 일지의 날짜·맥락·실제 과정 기록 |
| 2 | Rule, Tabard & Hollan (2018), [Exploration and Explanation in Computational Notebooks](https://adamrule.com/files/papers/chi_2018.pdf) | CHI 관찰 연구. 탐색과 설명이 충돌하는 실제 사용 양상 |
| 3 | Sandve et al. (2013), [Ten Simple Rules for Reproducible Computational Research](https://journals.plos.org/ploscompbiol/article?id=10.1371/journal.pcbi.1003285) | 실무 권고. 입력부터 결과까지의 추적 가능성 |
| 4 | Nosek et al. (2018), [The preregistration revolution](https://pmc.ncbi.nlm.nih.gov/articles/PMC5856500/) | 방법론 논의. 가설 생성과 검증, 사전 계획과 사후 해석 |
| 5 | Rule et al. (2019), [Ten simple rules for writing and sharing computational analyses in Jupyter Notebooks](https://journals.plos.org/ploscompbiol/article?id=10.1371/journal.pcbi.1007007) | 실무 권고. 설명·실행 순서·재사용 가능한 계산 문서 |
| 6 | Rethlefsen et al. (2021), [PRISMA-S](https://link.springer.com/article/10.1186/s13643-020-01542-z) | 보고 지침. 검색 경로를 검토·반복할 수 있게 남기기 |
| 7 | Pineau et al. (2021), [Improving Reproducibility in Machine Learning Research](https://jmlr.org/papers/v22/20-303.html) | 프로그램 보고. ML 재현 체크리스트와 동료 재현 |
| 8 | Steegen et al. (2016), [Increasing Transparency Through a Multiverse Analysis](https://stat.columbia.edu/~gelman/research/published/multiverse_published.pdf) | 방법 제안과 사례 분석. 분석 선택에 따른 결론의 민감도 |
| 9 | Wilkinson et al. (2016), [The FAIR Guiding Principles](https://www.nature.com/articles/sdata201618) | 원칙 제안. 연구 자산을 사람과 기계가 재사용할 조건 |

위 목록은 생산성 개선 효과의 순위가 아니라 이번 프로젝트에서 읽고 적용하기 쉬운 순서다.

## 4. 참고할 사이트와 제품

| 사이트 | 공식 자료에서 확인한 특징 | MCPVault가 참고할 부분 |
| --- | --- | --- |
| [eLabFTW](https://doc.elabftw.net/docs/usage/user-guide/experiments/) | 실험 항목, 템플릿, 연결 자료와 본문 revision 조회 | 같은 실험 양식을 재사용하고 원래 기록으로 돌아가는 UX |
| [Zotero](https://www.zotero.org/support/pdf_reader) | PDF 주석, 인용, 노트에서 원문 페이지로 돌아가기 | 출처와 해석이 분리된 문헌노트 |
| [OSF / COS](https://www.cos.io/initiatives/prereg) | 사전등록 안내와 연구 계획 기록 | 계획 시점·변경 이유·탐색 여부를 명확히 보여주기 |
| [protocols.io 소개](https://www.nature.com/articles/s41596-024-01012-z) | 인용 가능한 DOI를 가진 연구 방법 공유 | 재사용할 프로토콜과 실행별 관찰을 구별하기 |
| [MLflow Tracking](https://mlflow.org/docs/latest/ml/tracking) | run별 파라미터·지표·산출물·데이터 연결과 비교 | 실험 추적기를 복제하기보다 run 링크와 해석 노트 연결 |
| [Quarto](https://quarto.org/docs/get-started/computations/rstudio) | 설명·계산 코드·결과를 결합한 문서 생성 | 완료된 분석을 읽을 수 있는 연구 보고서로 연결 |
| [Jupytext](https://jupytext.org/using/paired-notebooks/) | 노트북과 텍스트 파일을 짝지어 버전 관리 | Markdown 기반 편집과 계산 노트북의 선택적 연결 |
| [OpenAlex](https://help.openalex.org/data/works/) | 학술 문헌 식별자, 검색·필터와 인용 관계 | 문헌 발견과 서지정보 보완. 인용 수는 진실 판정이 아님 |
| [RO-Crate](https://www.researchobject.org/ro-crate/about_ro_crate) | 방법·데이터·산출물과 메타데이터를 연결한 연구 묶음 | 장기 보존·인계·선택적 내보내기 |
| [루만 아카이브](https://niklas-luhmann-archiv.de/nachlass/zettelkasten) / [Andy Matuschak](https://notes.andymatuschak.org/Evergreen_notes_should_be_concept-oriented) | 연결된 카드와 개념 중심 노트의 실제 사례 | 논문별 수집에서 주제·주장별 지식으로 발전시키기 |

제품 기능은 공식 문서에서 확인했으며 직접 설치·연동 테스트한 것은 아니다. 도입 권고가 아니라 설계 참고다. Quarto/Jupytext 같은 도구를 연결하더라도 렌더링된 결과나 동기화 성공만으로 재현 성공을 판정해서는 안 된다.

## 5. MCPVault에 적용할 우선순위

아래 항목은 기존 기능의 사용성과 연결을 보완할 **후보**다. 현재 확인 범위에서 부족해 보이는 지점이며 저장소 전체에 기능이 없다는 단정은 아니다.

| 우선순위 | 개선 후보 | 기존 기반 활용 | 기대 효과를 확인할 방법 |
| --- | --- | --- | --- |
| P0 | 짧은 연구일지 작성 흐름 | journal / capture / 질문·실험 링크 | 다음 세션이 실제 시도와 다음 행동을 재질문 없이 찾아내는지 |
| P0 | 문헌노트와 검색 기록 양식 | literature / source / evidence / claim matrix | 다른 사람이 주장 근거의 정확한 위치와 검색·채택 이유를 찾는지 |
| P1 | 실험 조건과 산출물의 최소 기록 | experiment / investigation / `tests` | 한 실험의 정확한 코드·데이터·설정·관찰을 식별하고 재실행할 수 있는지 |
| P1 | 탐색·사전 계획·결과·정정 구별 | `planRevision` / expectedRevision / Git | 나중에 바뀐 기준과 처음 사용한 기준을 혼동하지 않는지 |
| P1 | 조건별 실험 비교와 판단 변화 | synthesis / decision record / applications | 무엇을 바꾸어 어느 관찰이 달라졌는지 설명할 수 있는지 |
| P2 | 완료 연구의 인계·내보내기 | 기존 원본·참조·scope 규칙 | 독립된 환경에서 필요한 파일과 허용된 근거를 찾아 복원하는지 |

작성 양식의 필수 항목은 연구 종류에 따라 최소화한다. 개념 조사에 GPU·seed를 요구하지 않고, 실행하지 않은 검토에 실행 성공 상태를 부여하지 않는다. 신규 구조화 필드가 필요하다면 구현 담당과 계약을 먼저 합의한다.

## 6. 가벼운 작성 예시

아래는 **본문 양식 제안**이다. 실제 연구 결과가 아니며 새로운 API 필드나 이미 지원되는 schema를 선언하지 않는다. 예시 링크는 실제 대상을 선택한 뒤 작성한다.

```markdown
# 연구일지: [날짜] [다룬 질문]

## 질문과 목적
어떤 불확실성을 줄이려 했는가? 관련 질문·실험 노트 링크.

## 실제 한 일과 관찰
검색·독해·실험 등 실제 수행한 일. 원문 위치 또는 실행 기록 링크.
관찰된 사실과 아직 확인하지 못한 것을 구별한다.

## 해석과 판단 변화
기존 예상과 무엇이 달랐는가? 어떤 결정을 바꿨는가?
가능한 다른 설명, 적용 조건, 한계.

## 다음 행동
이어갈 질문 하나와 실행 가능한 다음 단계.
```

긴 실험 내용은 해당 experiment 노트의 Protocol / Environment / Observations / Result / Reproduction에 두고 일지에서는 연결한다. 문헌 조사라면 검색 기록과 문헌노트가 중심이 된다. 재사용할 결론이 생겼을 때만 atomic 또는 synthesis 노트로 정리한다.

## 7. 작은 검증 실험 제안

실제 연구 주제 하나에서 기존 방식과 제안 양식을 비교하는 파일럿이 적합하다. 아직 실행하지 않았다.

1. 같은 유형의 연구 활동 몇 건에 기존 방식과 최소 양식을 적용하고 작성 시간을 기록한다.
2. 다음 세션의 연구자/에이전트가 질문·근거·실제 수행·판단 변경·다음 행동을 복원하게 한다.
3. 빠진 정보, 근거 위치를 찾는 시간, 재질문 수, 중복 시도와 작성 부담을 비교한다.
4. 실행 연구라면 같은 입력으로 재실행한 결과와 허용 오차를 별도로 확인한다.
5. 점수가 좋아져도 기록 양식 자체가 과학적 진실이나 독립 재현을 증명한다고 해석하지 않는다.

비교의 평가 질문과 성공 기준은 시작 전에 정하고, 결과가 나쁜 경우 양식을 줄이거나 수정한다. 최소 양식이 실제 연구를 덜 방해하면서 다음 연구를 더 쉽게 만드는지를 우선 평가한다.
