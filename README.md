# NOVAIL · 사람과 함께 쓰는 소설 작업실

한국어 장편의 원고, 기획, 피드백, 수정 후보와 버전을 함께 다루는 웹 애플리케이션입니다. **후보 생성과 공식 원고 채택은 다른 동작**이며, 직접 편집을 저장하는 것만으로 공식 작업본이 바뀌지 않습니다.

> 구현 범위: 제공된 `novail.md` 명세의 첫 번째 종단 간 협업 흐름을 실행할 수 있는 단일 사용자 구현입니다. 명세 전체의 M0–M3 완료 또는 AT-01–28 전체 통과를 주장하지 않습니다. 아래의 구현 범위와 제한을 확인하세요.

## 시작하기

Node.js **24.22.0 이상**과 pnpm을 사용합니다. 저장소의 `.node-version`은 `24.22.0`으로 고정되어 있으므로 사용하는 버전 관리자에서 이를 적용하세요.

```sh
npx pnpm install
npx pnpm build
npx pnpm start
```

`http://localhost:3000`에서 열립니다. 초기 작품 **푸른 인장의 밤**에는 항구 봉쇄, 보호 문장, 초반 단서와 18장의 회수 관계가 들어 있습니다.

### PostgreSQL과 함께 실행

```sh
docker compose up --build
```

`http://localhost:8080`에서 열립니다. PostgreSQL 18 데이터는 Docker volume에 보존됩니다. 개발용 기본 DB 비밀번호는 외부에 공개하지 말고 실제 배포에서는 바꾸세요.

Node 서버만 직접 실행하려면 `.env.example`을 참고해 `.env`를 만들고 `DATABASE_URL`을 설정합니다. `DATABASE_URL`이 없으면 `app/data/local-state.json`에 원자적으로 저장합니다. 파일 모드는 단일 프로세스 개발용이며 다중 Worker에는 PostgreSQL을 사용하세요.

### 실제 모델 연결

```dotenv
OPENAI_API_KEY=your-key
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_API=chat-completions
# Optional default; otherwise select a model in the web UI.
OPENAI_MODEL=
```

에이전트 경로는 SSE 스트리밍, function tool 호출, strict JSON Schema 출력을 함께 지원하는 OpenAI 호환 Chat Completions API가 필요합니다. "OpenAI 호환"을 표방하는 모든 제공자나 모델이 이 조합을 지원하는 것은 아닙니다. 최종 JSON은 로컬 스키마와 선택된 모든 ID, 보호 원문 조건으로 다시 검증합니다. 키는 서버에만 보관하며 브라우저 응답에 포함하지 않습니다. 키가 없으면 **AI가 아닌 로컬 예제 모드**로 표시됩니다. 제공자 장애를 예제 응답으로 숨기지 않습니다. 실제 모델의 문학적 품질이나 제공자의 데이터 보관 정책은 보장하지 않습니다.

키와 base URL은 서버 시작 시 `.env`에서 읽습니다. 실행 모델은 웹 UI의 **에이전트 실행** 또는 **AI 수정 제안**에서 선택하며, `OPENAI_MODEL`은 선택적인 기본값입니다. 선택한 모델은 Run에 고정되어 이후 기본값 변경의 영향을 받지 않습니다. 모델 목록을 제공하지 않는 호환 서버에서는 모델 ID를 직접 입력할 수 있습니다. 브라우저에는 모델 목록과 실행 상태만 노출되며 비밀 키는 전송하지 않습니다.

설정 후 표준 모델 목록 조회와, 명시적으로 동의한 경우에만 실제 Part 도구 루프를 확인할 수 있습니다.

```sh
pnpm provider:check
pnpm provider:check --generate # CLI에서는 OPENAI_MODEL 필요; 실제 호출과 quota를 사용할 수 있음
pnpm start
```

기본 검사는 인증된 `GET /models`만 사용합니다. 모델 목록 API가 없는 호환 프록시는 `MODEL_CATALOG UNAVAILABLE`로 정직하게 표시하며, 생성·스트리밍·도구·strict schema 지원을 추정하지 않습니다. `--generate`만 격리된 NOVAIL Part run으로 실제 SSE, 읽기 전용 도구 loop와 strict JSON 결과 경로를 확인합니다. 개인 Codex 계정을 Router4U로 연결할 때는 [`docs/router4u.md`](docs/router4u.md)의 게이트웨이 설치·로그인·프로젝트 키 절차를 따르되 NOVAIL에는 같은 `.env`와 일반 명령을 사용하세요.

API 프로토콜은 `OPENAI_API=chat-completions`가 기본입니다. Responses 전용 모델이나 Codex 라우트는 `OPENAI_API=responses`로 설정하세요. 이 경우 Part의 Responses 어댑터가 `/responses`, `text.format`, `max_output_tokens`와 도구 이력을 처리합니다. 모델과 프로토콜은 실행 등록 시 고정됩니다. 실행 실패 시 **에이전트 실행 → 실행 실패 진단**에서 단계·HTTP 상태·원인 코드·요청 ID를 확인하고 안전한 로그를 복사할 수 있습니다. 키, 원문 입력과 원시 제공자 오류 본문은 진단 로그에 포함하지 않습니다.

### 다른 환경에서 이어서 실행

Node 24.22.0 이상에서 `pnpm install --frozen-lockfile`과 `pnpm build`를 실행한 뒤, 해당 환경의 비공개 `.env`를 준비하고 `pnpm start`로 시작합니다. 키·OAuth 자격 증명·원고 저장 파일은 Git에 포함되지 않습니다. 기존 원고를 이어 쓰려면 실제 사용 중인 PostgreSQL 또는 `NOVAIL_DATA_FILE` 데이터를 별도로 안전하게 백업·이전하세요. Router4u를 함께 옮기는 경우에는 [게이트웨이 안내](docs/router4u.md)에 따라 두 볼륨을 보존하고, 이전 설치와 새 설치를 같은 OAuth 자격 증명으로 동시에 실행하지 마세요. 기존 DIM URL과 `/tmp` 파일 경로는 새 환경에서 다시 준비해야 합니다.

### 개발

```sh
npx pnpm dev:api
# 별도 터미널
npx pnpm dev
```

Vite는 5173, API는 3000 포트입니다. `PORT`로 API 실행 포트를 바꿀 수 있습니다. 운영 빌드는 API 서버가 `dist/`를 직접 제공합니다.

### 에이전트 실행

웹 UI의 **에이전트 실행** 탭에서 장면·기획과 실행 예산을 선택하고, 최근 Run 기록과 SSE 진행 이벤트를 보며, 실행을 취소하거나 생성된 변경 세트를 **개정 검토**에서 열 수 있습니다. 생성 결과는 항상 검토 대기 제안이며 자동 채택되지 않습니다.

이 경로는 실험적 [`@slop-lab/part` `0.1.0`](https://www.npmjs.com/package/@slop-lab/part/v/0.1.0)과 [`@slop-lab/part-plugins` `0.1.0`](https://www.npmjs.com/package/@slop-lab/part-plugins/v/0.1.0)을 정확한 버전으로 고정합니다. 두 패키지의 소스 기준은 [`slop-lab/part`](https://github.com/slop-lab/part)입니다. 허용 도구, 예산·사용량 의미, 큐 복구, 공개 API와 제한은 [`docs/runtime.md`](docs/runtime.md)를 참조하세요.

## 사용 흐름

1. 왼쪽 목록에서 장면을 선택해 본문과 관련 맥락을 확인합니다.
2. 직접 편집 후 **초안 저장**으로 미채택 작업을 보존합니다.
3. 피드백을 입력하거나 직접 편집한 원고로 수정 후보를 만듭니다.
4. 후보의 전후 원고와 영향 검토 대상을 확인합니다. 검토 대상에 포함되어도 다른 장면은 자동 재작성되지 않습니다.
5. **채택**하면 해시·현재 head·보호 문장을 검사하고 새로운 snapshot을 만듭니다. 후보 생성만으로는 head가 바뀌지 않습니다.
6. 버전 기록에서 과거 내용을 복원하거나 Markdown 원고를 내보냅니다. 복원도 새 이력을 남깁니다.
7. **버전 기록 → 작업본 스냅샷**에서 선택한 버전의 Markdown·DOCX·manifest를 내려받습니다. 미채택 초안은 포함되지 않습니다.
8. **판본 발행**에서 장면 목록·분량·manifest hash를 확인하고 승인하면 작업실 안에 불변 판본을 기록합니다. 외부 서점이나 플랫폼에 공개하는 동작은 아닙니다.
9. 다음 판본은 가장 최근 판본을 명시적으로 승인한 개정판으로 기록합니다. 작업 원고를 수정하거나 복원해도 이전 판본의 원문과 다운로드는 바뀌지 않습니다.
10. **버전 기록 → 작업 분기**에서 현재 작업본 또는 맥락이 기록된 과거 스냅샷으로 새 분기를 만듭니다. 생성만으로 전환되지 않으며, 초안·후보·피드백은 원래 분기에 남습니다.
11. 분기를 바꾸면 해당 분기의 원고·기획·초안·후보·실행 기록을 다시 불러옵니다. 실행 중인 작업을 먼저 완료하거나 취소해야 전환할 수 있습니다.
12. 피드백 수리 또는 직접 제안으로 여러 장면·기획을 하나의 변경 세트에 묶고, 변경·유지 영향 대상을 검토한 뒤 사람이 명시적으로 채택합니다.
13. 일부만 채택하려면 루트 변경 세트에서 독립적인 원자 묶음을 골라 자식 변경 세트를 만듭니다. 자식에서 다시 파생하거나 병합 제안을 부분 채택할 수는 없습니다.
14. 다른 분기를 합칠 때 먼저 2-parent 미리보기를 만들고 충돌마다 source·target·직접 작성 값을 고른 뒤 봉인합니다. 봉인된 병합도 별도의 변경 세트이므로 다시 검토하고 채택해야 정본이 바뀝니다.
15. 변경 세트의 **사람의 수동 평가**에서 피드백 또는 제안 사유를 평가 기준으로 삼고, 변경 전후 원문의 정확한 구절을 인용해 `충족`·`위반`·`알 수 없음`을 기록할 수 있습니다. 평가는 이력만 추가하며 채택을 실행하거나 대신하지 않습니다.

## 구현된 기반

- React 19 / TypeScript / Vite 기반 한국어 집필 UI, 기획·타임라인·개정 검토·버전 화면
- Hono API와 Zod 입력 검사, 멱등 요청 키와 충돌 감지
- PostgreSQL 트랜잭션 및 행 잠금, 파일 저장 대안
- 후보와 공식 원고 분리, head 경쟁 검사, SHA-256 후보 해시, 보호 원문 검사
- 스냅샷 보존과 복원, 감사 및 outbox 레코드
- 의미 의존성의 순환 안전 탐색과 장거리 검토 대상 표시
- Unicode code point span 검증, 브라우저 UTF-16 offset 변환
- 필수 맥락 예산·미정 결정·공개 정책·경계 조건 준비도 검사
- 상대적 시간 제약의 모순 검출, 증거 부족은 unknown으로 유지
- 내구성 Run/Job 큐, 원자적 호출 예약, lease fencing, 취소 후 늦은 결과 차단
- 영구 Run 이벤트와 Last-Event-ID 기반 SSE 재접속
- Part `createAgent` 모델 루프, 세 개의 동결된 읽기 전용 도구, 호출·도구·토큰·호출당 출력·deadline 예산, 실행 취소
- 에이전트 실행 탭의 범위·예산 작성, 최근 기록, 공개 SSE 진행 상황, 사용량, 결과 검토 연결
- 스냅샷별 Markdown·DOCX·manifest 내보내기, 한글·특수문자·줄바꿈 보존
- 내용 hash와 검토 시점 head에 묶인 판본 발행 승인, 별도 개정판 승인, 불변 판본과 승인·감사·outbox 이력
- 공유 스냅샷을 기준으로 한 작업 분기 생성·전환, 분기별 초안·기획·후보·실행 격리, 동일 head의 다른 분기에 대한 잘못된 쓰기 차단
- 기존 작품의 기본 분기 이관과 기존 스냅샷·후보 hash·판본 보존
- 장면·기획·의존성·배치를 함께 다루는 V2 변경 세트, 분리할 수 없는 atomic bundle, 루트에서의 부분 선택·파생
- 변경된 대상과 변경되지 않은 영향 대상을 구분한 검토, 변경 세트 hash·base workspace hash·현재 head에 묶인 명시적 사람 승인
- 2-parent 분기 병합 미리보기, scene/plan/dependencies/layout 충돌의 명시적 해소, 봉인 후 별도 채택과 병합 조상 기록
- 피드백의 대기·부분 적용·적용·재개 상태 연결, 취소 작업의 알려진 사용량 보존과 늦은 결과 거절
- 고정된 변경 세트와 정확한 원문 인용에 묶인 사람 작성 평가, hash 연결된 추가 전용 이력, 현재 기준과 달라진 과거 보고서 보존

## 명세 대비 남은 범위

- 현재 API는 UI용 `/api` 경로와 camelCase 계약입니다. 명세 18절의 `/v1/projects/{project_id}` 전체 리소스·snake_case 계약과 완전 호환되지는 않습니다.
- 저장 모델은 JSONB 집계 문서입니다. 명세 16절의 정규화된 Artifact/Revision/Graph 전체 테이블, 복합 FK와 개별 리비전 질의는 아직 구현하지 않았습니다.
- 단일 사용자 작업실입니다. 다중 사용자 로그인, 역할별 ACL, Reviewer 블라인드 열람과 프로젝트별 모델 전송 정책은 완전한 배포 전 추가 구현이 필요합니다.
- P0–P6 전역 기획 자동화, 별도 Extractor/Evaluator, 근거 기반 상태 투영, 의미 diff와 전체 원고 보완 검색은 전체 명세 수준에 도달하지 않았습니다.
- 여러 Artifact의 atomic bundle, 독립 묶음 단위의 부분 채택과 2-parent 분기 병합은 구현했습니다. 다만 영향 분석은 의존성·식별자·규칙에 따른 보수적 휴리스틱이며 작품 의미의 정확성을 증명하지 않습니다. 장면 외 기획·의존성·배치의 병합도 자동 의미 통합이 아니라 명시적 선택을 요구합니다.
- 분기 이름 변경·삭제와 외부 출판 서비스 연동은 포함하지 않습니다. 병합 변경 세트의 부분 파생과 파생 자식의 재귀 파생도 의도적으로 허용하지 않습니다.
- 분기 도입 이전의 과거 스냅샷에는 기획 맥락이 없을 수 있습니다. 그런 스냅샷의 분기는 차단하며, 현재 기준본이나 맥락이 기록된 새 스냅샷에서 시작해야 합니다. 없는 과거 설정을 현재 설정으로 추정해서 채우지 않습니다.
- Run은 하나의 후보 작업 단위를 실행합니다. 일반적인 다중 Job DAG, 반복 수정 정책과 공급자별 금액 정산은 미완성입니다. lease 만료 후 사용량이 불명확하면 예약을 유지하고 실패 상태로 남겨 명시적 새 실행을 요구합니다.
- 모델 사용량을 제공자가 보고하지 않으면 예약한 호출당 출력 한도 전체를 보수적 추정치로 차감하며 실제 소비 토큰을 뜻하지 않습니다. 응답 후 저장 전 장애나 취소 시 이미 발생한 제공자 과금 가능성을 제거했다고 주장하지 않습니다.
- Part 경로에는 셸·네트워크·쓰기·승인 도구, 별도 프로세스 브리지, 브라우저용 Part 런타임, 자동 의미 평가기가 없습니다. 기존 단일 장면 V1 직접 gateway 호환 경로도 Part 실행으로 간주하지 않습니다.
- 실서비스 인터넷 공개 전 인증·접근제어·백업 복구·부하 검증이 필요합니다. 현재 기본 모드는 신뢰할 수 있는 개인 개발 환경용입니다.

## 검증

```sh
npx pnpm typecheck
npx pnpm test
npx pnpm build
```

테스트는 생성 문장을 고정하지 않고 원문 보존, 승인 경계, 오래된 베이스, 보호 문장, 멱등성, 시간 제약, span, 취소, lease, 예산 예약, SSE 복구와 V2 변경 세트·부분 파생·병합을 검사합니다. 실제 유료 공급자 호출은 API 키가 있는 환경에서 별도로 확인해야 합니다.

런타임과 공개 진행 계약은 [`docs/runtime.md`](docs/runtime.md), Router4U 개인 Codex 연결은 [`docs/router4u.md`](docs/router4u.md), 분기 API와 호환성은 [`docs/branches.md`](docs/branches.md), V2 변경 세트·부분 파생·병합 계약은 [`docs/revisions.md`](docs/revisions.md), 판본 API와 보호 계약은 [`docs/editions.md`](docs/editions.md), 사람 평가 계약은 [`docs/evaluations.md`](docs/evaluations.md)를 참조하세요. 구현되지 않은 다음 우선순위와 완료 기준은 [`docs/roadmap.md`](docs/roadmap.md)에 정리합니다.

## 코드 구조

```text
src/                    한국어 편집 UI와 API 클라이언트
app/                    API, 영속 저장, 후보/버전 도메인, 모델 gateway
packages/domain/        준비도, Unicode span, 시간 제약 검사
packages/execution/     Run/Job lease, 예약, Worker, SSE
packages/revision/      변경 세트, 영향 검토, 부분 파생, 병합 계보
DESIGN.md               디자인 토큰, 화면 및 접근성 규칙
docs/                   런타임·Router4U 연결·분기·개정·판본·평가 계약과 후속 로드맵
compose.yml             PostgreSQL과 앱 실행 구성
```

DIM 환경의 기존 수명주기 설정은 `.dim/`에 보존했습니다.
