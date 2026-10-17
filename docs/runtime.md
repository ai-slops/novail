# Part 에이전트 런타임 계약

NOVAIL의 **에이전트 실행**은 선택한 장면과 기획을 읽기 전용 맥락으로 고정하고, 모델이 만든 수정안을 V2 변경 세트로 남기는 제한된 수리 경로입니다. 결과는 `awaiting_decision` 상태의 제안일 뿐이며 사람이 검토하고 채택하기 전에는 정본을 바꾸지 않습니다.

## 버전과 소스 기준

- [`@slop-lab/part` `0.1.0`](https://www.npmjs.com/package/@slop-lab/part/v/0.1.0)
- [`@slop-lab/part-plugins` `0.1.0`](https://www.npmjs.com/package/@slop-lab/part-plugins/v/0.1.0)
- 두 패키지의 upstream 소스: [`slop-lab/part`](https://github.com/slop-lab/part)
- Node.js `>=24.22.0`; `.node-version`과 Docker 이미지는 `24.22.0`을 사용합니다.

Part API는 실험적이므로 두 의존성은 정확히 `0.1.0`으로 고정합니다. `pnpm-workspace.yaml`의 release-age 예외도 이 두 버전에만 적용하며, 일반적인 신규 의존성 제한을 해제하지 않습니다.

## 실행 경계

1. `POST /api/repair-runs`가 현재 분기, base snapshot과 workspace hash, 선택 ID, 지시문과 예산을 검증하고 입력 workspace를 Run에 고정합니다.
2. NOVAIL의 영속 Run/Job 큐가 Job을 lease로 claim합니다. 각 claim은 메모리 안에서 새로운 Part `createAgent`와 basic driver를 만들며 Part의 실행 stack 자체는 재시작 후 복구하지 않습니다.
3. 모델은 아래 세 도구로 고정된 맥락을 읽고 strict JSON 수정안을 반환합니다.
4. 서버는 JSON shape, 선택된 모든 장면·기획 ID가 정확히 한 번씩 포함됐는지, 대상 ID가 바뀌지 않았는지, 보호 문장이 보존됐는지를 다시 검증합니다.
5. 형식과 선택 범위가 유효한 결과는 V2 변경 세트로 남깁니다. 보호 조건 등 작업 공간 검증에 실패한 생성안도 문제를 확인할 수 있도록 보존하지만 채택은 차단합니다. 모델이나 도구에는 채택 권한이 없습니다.

기존 단일 장면 V1 Run과 직접 OpenAI 호환 gateway는 하위 호환을 위해 남아 있지만 Part 경로가 아닙니다. Part 계약은 `repair_bundle` 실행에만 적용됩니다.

## 허용 도구와 모델 입력

도구 ID는 점 표기가 아닌 다음 underscore 이름을 사용합니다.

- `novail_read_selected_scenes`: 선택한 장면 원문과 보호 문장
- `novail_read_selected_plans`: 선택한 기획 항목
- `novail_read_readonly_context`: 읽기 순서, 활성 제약, 관련 장면과 의존성

세 결과는 Run 생성 시점 workspace에서 복제하고 동결합니다. 모델이 읽는 원고 데이터는 지시나 승인으로 취급하지 않습니다. 셸, 임의 네트워크, 파일 또는 workspace 쓰기, 승인 도구는 제공하지 않습니다. 제공자 HTTP 호출은 도구가 아니라 서버가 구성한 모델 transport를 통해서만 나갑니다.

## 모델과 출력 계약

`OPENAI_API_KEY`가 있으면 `OPENAI_BASE_URL` 아래 `/chat/completions`와 `OPENAI_MODEL`을 사용합니다. 제공자는 한 실행 안에서 다음 기능을 함께 지원해야 합니다.

- SSE streaming Chat Completions
- function tool 호출과 이어지는 모델 turn
- `response_format.type=json_schema`와 `strict: true`
- 호출당 `max_completion_tokens`

OpenAI 호환 변형 중 일부는 이 조합이나 usage 보고를 지원하지 않을 수 있습니다. 연결 실패, 잘못된 tool 호출, schema-invalid JSON, 선택 범위 불일치, 잘린 응답은 Run 실패이며 로컬 결과로 대체하지 않습니다.

키가 없으면 Part `fakeModel`을 사용하는 결정적 `local-demo`가 실행됩니다. UI와 `/api/runtime-info`는 이를 **AI가 아닌 로컬 예제**로 표시합니다. 이 모드는 실제 모델 품질 검증이 아닙니다.

## 예산과 사용량

Run은 `maxModelCalls`, `maxToolDispatches`, `maxKnownTokens`, `maxOutputTokens`, `maxOutputTokensPerInvocation`, `deadlineSeconds`를 가집니다. 기본값은 각각 `4`, `8`, `64,000`, `16,000`, `4,000`, `120`이며 UI는 서버가 공개한 허용 범위 안에서 수정합니다.

- 외부 모델 호출 전에 호출 1회와 호출당 최대 출력 토큰을 원자적으로 예약합니다.
- Part는 모델 호출 수, 도구 dispatch 수, 호출당 출력 한도와 전체 deadline을 함께 제한합니다. 동시 operation은 1개입니다.
- 제공자가 usage를 반환하면 입력·출력을 `provider-reported`로 기록하고 알려진 토큰 및 출력 예산에 반영합니다.
- 알려진 토큰 한도는 응답 사용량을 기록한 뒤 검사합니다. 한도 초과 결과는 채택 가능한 제안으로 만들지 않지만 이미 발생한 외부 비용을 되돌리지는 못합니다.
- 제공자가 output usage를 생략하면 **예약한 호출당 출력 한도 전체**를 `estimated` 출력으로 차감합니다. 이는 보수적인 예산 수치이며 실제 사용 토큰이라는 뜻이 아닙니다. 입력 usage가 없으면 공개 값은 `null`입니다.
- 호출 결과를 알 수 없으면 예약을 유지합니다. 취소가 요청됐거나 응답을 받은 뒤에도 제공자가 이미 과금했을 수 있습니다.

## 내구성, 취소와 복구

Run, Job, 모델 시도 예약과 공개 이벤트는 NOVAIL store에 영속됩니다. 로컬 파일 store는 단일 프로세스 개발용이고, 다중 Worker 배포에는 PostgreSQL을 사용합니다. 별도 SQLite 저장소는 없습니다.

Job lease는 주기적으로 갱신되고 lease token으로 늦은 결과를 차단합니다. 취소는 Run을 즉시 취소 상태로 만들고 활성 Part handle에 best-effort 취소를 요청합니다. 이미 시작한 provider 호출은 종료 또는 비과금을 보장하지 않습니다.

프로세스 종료나 lease 만료로 사용량을 확정할 수 없으면 Run은 `USAGE_UNKNOWN`으로 fail closed 됩니다. 예약을 해제하거나 자동 재시도하지 않으며, 사용자가 현재 base에서 명시적으로 새 Run을 만들어야 합니다. 즉, NOVAIL 큐는 영속적이지만 Part agent와 모델 대화 stack은 lease 단위의 일시적 실행입니다.

## 공개 API와 이벤트

- `GET /api/runtime-info`: Part `0.1.0`, 현재 서버 mode와 model label, 공개 예산 기본값·범위, 허용 도구 ID
- `POST /api/repair-runs`: 범위가 지정된 Part 수리 Run 생성
- `GET /api/runs?limit=...`: 현재 분기의 최근 queue-managed Run
- `GET /api/runs/:id`: 안전한 Run 요약과 Job 요약
- `POST /api/runs/:id/cancel`: 취소 요청
- `GET /api/runs/:id/events`: `Last-Event-ID`를 지원하는 SSE replay와 live stream

변경 요청은 현재 분기와 idempotency key에 묶입니다. 공개 DTO에는 상태, 예산, 집계 usage, runtime 출처, 안전한 오류와 결과 참조만 들어가며 lease token, 동결된 입력 workspace, 원문 context pack, provider key는 포함하지 않습니다.

SSE는 저장된 이벤트를 먼저 replay한 뒤 live 이벤트를 보내고 terminal 상태에서 닫힙니다. 알 수 없는 `Last-Event-ID`는 `EVENT_CURSOR_EXPIRED`로 거절하며 UI는 전체 상태와 이벤트를 다시 읽습니다. 공개 텍스트 delta는 조각당 1,024자, 텍스트·gap 진행 이벤트는 Run당 최대 128개 또는 64 KiB로 제한됩니다. 한도 이후 진행 내용은 생략하고 truncation 표시를 남기지만 모델·도구와 종료 상태 이벤트는 계속 기록합니다. 이는 공개 가능한 결과 진행 텍스트이며 모델의 비공개 chain-of-thought를 저장하거나 노출하는 계약이 아닙니다.

## 웹 UI와 제외 범위

**에이전트 실행** 탭은 runtime mode, 세 도구, 범위·예산 composer, 최근 50개 Run, 사용량, SSE 이벤트, 취소, 결과 검토 연결을 제공합니다. provider key, model, base URL을 저장하거나 연결 시험을 실행하는 설정 UI는 아직 없습니다. 키는 서버 환경 변수에만 둡니다.

이 통합에는 별도 process bridge, 브라우저에서 실행되는 Part 런타임, 셸·네트워크·쓰기·승인 도구, 자동 semantic Extractor/Evaluator가 포함되지 않습니다. 다음 실제 제공자 설정·연결 시험과 품질 검증 범위는 [`roadmap.md`](roadmap.md)에 있습니다.
