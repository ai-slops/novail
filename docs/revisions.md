# V2 변경 세트와 병합 계약

## 핵심 원칙

NOVAIL V2는 **제안 생성**, **검토**, **정본 채택**을 분리합니다. 직접 제안, 피드백 수리 Run, 기존 V1 후보 승격 또는 분기 병합 봉인은 검토할 변경 세트를 만들 뿐입니다. 정본 workspace와 branch head는 사람이 명시적으로 채택할 때만 바뀝니다.

변경 세트는 장면(`scene`), 기획(`plan`), 의존성(`dependencies`), 배치(`layout`)를 함께 담을 수 있습니다. 여러 변경이 하나의 atomic bundle이면 부분 선택 과정에서도 나눌 수 없습니다.

영향 목록은 의존성, 식별자와 구현 규칙으로 계산하는 보수적 **검토 보조 휴리스틱**입니다. 목록에 있다고 자동 재작성되는 것도 아니고, 목록을 모두 확인했다고 작품의 의미적 일관성이 증명되는 것도 아닙니다.

## HTTP 경로

현재 계약은 UI용 `/api`와 camelCase입니다.

| 경로 | 역할 |
| --- | --- |
| `GET /api/revision-context` | 현재 `projectId`, `branchId`, `baseSnapshotId`, `workspaceHash`, workspace 조회 |
| `GET /api/change-sets/{id}` | 변경 세트와 상태·검토 요구 조회 |
| `POST /api/change-sets` | 사람이 직접 V2 변경 세트 제안 |
| `POST /api/change-sets/{id}/derive` | 루트 변경 세트에서 선택한 변경으로 자식 파생 |
| `POST /api/change-sets/{id}/commit` | 검토 증거와 해시를 제출해 명시적 채택 |
| `POST /api/change-sets/{id}/reject` | 제안 거절 |
| `POST /api/candidates/{id}/promote` | 기존 V1 후보를 V2 변경 세트로 승격 |
| `POST /api/feedback/{id}/resolve` | 피드백 닫기·보류·다시 열기 |
| `POST /api/repair-runs` | 선택한 여러 장면·기획을 대상으로 수리 Run 시작 |
| `POST /api/merge-previews` | 현재 분기를 target으로 2-parent 병합 미리보기 생성 |
| `GET /api/merge-previews/{id}` | 병합 미리보기와 충돌 조회 |
| `POST /api/merge-previews/{id}/seal` | 미리보기 hash와 해소 값을 확인해 atomic 병합 변경 세트 생성 |

### 직접 제안

`POST /api/change-sets`의 요청은 strict schema이며 알 수 없는 필드를 거절합니다. 변경은 최대 50개입니다.

```json
{
  "baseSnapshotId": "<검토한 현재 snapshot>",
  "baseWorkspaceHash": "<검토한 workspace hash>",
  "reason": "변경 이유",
  "changes": [
    {
      "kind": "scene",
      "artifactId": "scene-1",
      "after": {
        "id": "scene-1",
        "title": "첫 장면",
        "chapter": 1,
        "status": "canon",
        "text": "수정한 본문",
        "summary": "장면 요약",
        "storyTime": "첫날 밤",
        "characters": [],
        "protectedQuotes": []
      }
    }
  ],
  "feedbackIds": [],
  "atomic": true
}
```

입력 변경 항목은 `kind`, `artifactId`, `after`로 구성되며 `before`는 서버가 만든 응답 entry에만 있습니다. `after`는 종류별 Zod 계약을 만족해야 하고 삭제를 지원하는 종류에서는 `null`일 수 있습니다. 장면 ID처럼 artifact identity를 변경 항목 안에서 바꿀 수 없고 보호 문장은 결과 본문에 그대로 존재해야 합니다. `atomic`은 선택 boolean이며 기본값은 `false`입니다. 요청 성공만으로 head는 전진하지 않습니다.

## 검토와 명시적 채택

`POST /api/change-sets/{id}/commit`은 다음 형태의 승인 요청을 받습니다.

```json
{
  "expectedHead": "<검토 시점의 head>",
  "approvedHash": "<변경 세트 hash>",
  "reviewedKeys": ["<검토한 변경 없음 영향 대상 key>"],
  "decision": "accept",
  "policyVersion": 2
}
```

서버는 채택 직전에 다음 조건을 다시 검사합니다.

- 변경 세트가 현재 작품·분기의 `pending` 상태이고 schema/policy version이 2인지
- `approvedHash`가 저장 hash와 같고, 불변 payload로 다시 계산한 SHA-256도 같은지
- `expectedHead`, 제안의 base snapshot, base workspace hash가 현재 값과 같은지
- 영향 계산이 완료되었고 검증 issue가 없는지
- 알 수 없는 검토 key가 없으며, 변경되지 않은 필수 영향 대상을 모두 검토했는지
- queued/running/paused Run이 없고 origin Run이 취소되지 않았는지
- 파생 또는 병합의 부모·source binding이 여전히 유효한지
- 변경 적용 후 workspace가 종류별 schema, identity와 보호 조건을 만족하는지

하나라도 달라지면 오래된 승인을 재사용하지 않고 거절합니다. 성공하면 새 snapshot을 만들고 branch head를 전진시킵니다. 변경 세트 생성, Run 완료, 병합 미리보기 또는 봉인만으로는 이 동작을 대신하지 않습니다.

변경 세트 hash에는 base, 변경 항목, bundle, 영향·issue, 검토 요구, 연결된 feedback/run/candidate, 부모 정보와 병합 binding이 포함됩니다. workspace hash는 canonical workspace JSON에서 계산하므로 PostgreSQL JSONB의 키 순서에 의존하지 않습니다.

## 루트 전용 부분 파생

`POST /api/change-sets/{id}/derive`에는 루트 변경 세트에 속한 `changeIds`를 보냅니다.

```json
{
  "changeIds": ["<선택한 변경 id>"]
}
```

부분 파생 규칙은 다음과 같습니다.

- 부모는 V2의 hash-valid `pending` 루트 변경 세트여야 합니다.
- 파생된 자식에서 다시 자식을 만들 수 없습니다. 재귀 파생은 `RECURSIVE_DERIVATION_FORBIDDEN`으로 거절합니다.
- 병합 변경 세트는 부분 파생할 수 없습니다.
- 선택 ID는 모두 부모에 있어야 하며 atomic bundle을 쪼갤 수 없습니다.
- 자식은 부모 ID·부모 hash·선택한 부모 변경 ID를 저장합니다.
- 제외한 부모 변경은 자식 검토에서 필수 **변경 없음** 영향 대상으로 남습니다.
- 자식 채택 시 부모 hash, 선택 집합, bundle, policy와 origin Run을 다시 검사합니다.
- 자식을 채택하면 부모는 `partially_applied`가 됩니다. 부모 전체를 별도로 중복 채택하지 않습니다.

이 기능은 사람이 독립 묶음을 선택하는 구조적 부분 채택입니다. 시스템이 작품 의미상 안전한 최소 수정 집합을 증명하거나 임의로 추론하는 기능이 아닙니다.

## 피드백과 Run

피드백에 연결된 변경 세트를 만들면 열린 피드백은 `awaiting_decision`이 됩니다. 전체 채택은 `applied`, 자식의 일부 채택은 `partially_applied`로 연결합니다. 거절하면 해당 제안을 기다리던 피드백을 다시 엽니다.

명시적 피드백 결정은 현재 head와 함께 `close`, `defer`, `reopen` 중 하나와 note를 제출합니다. 이미 닫힘·보류 상태인 피드백을 취소 처리로 덮어쓰지 않습니다. 다른 살아 있는 후보나 변경 세트가 공유하는 피드백도 고아로 보지 않습니다.

취소가 요청된 Run에서 늦게 도착한 출력은 후보·변경 세트로 받아들이지 않습니다. 다만 제공자가 이미 보고한 알려진 사용량은 한 번 기록합니다. 사용량을 보고하지 않으면 추정치로 구분하며, lease가 만료되어 사용량을 알 수 없으면 예약을 유지하고 명시적인 새 실행을 요구합니다. 모델 응답 후 저장 전 장애에서 외부 중복 과금 가능성을 제거했다고 주장하지 않습니다.

## 2-parent 분기 병합

`POST /api/merge-previews`는 다음 target 문맥을 요구합니다.

```json
{
  "sourceBranchId": "<합칠 분기>",
  "expectedHead": "<현재 target head>",
  "baseWorkspaceHash": "<현재 target workspace hash>"
}
```

source와 target은 달라야 하며 source에 실행 중인 Run이 없어야 합니다. target은 요청한 head/hash와 같아야 하고, source가 이미 target 조상에 포함되어 있으면 중복 병합을 차단합니다. 공통 snapshot 조상에서 3-way 미리보기를 계산합니다.

- source만 바꾼 artifact는 들어오고 target만 바꾼 내용은 유지합니다.
- 양쪽이 같은 장면을 다르게 바꾸면 `both-changed` 충돌입니다. `source`, `target` 또는 schema-valid `custom` 값으로 해소합니다.
- 기획·의존성·배치 충돌도 자동 의미 통합하지 않고 명시적 해소를 요구합니다.
- 알 수 없는 과거 base를 현재 값으로 추정하지 않습니다. 충돌처럼 취급해 명시적 선택을 요구합니다.
- 충돌 해소 key는 중복되거나 알 수 없어서는 안 되며 모든 충돌을 빠짐없이 다뤄야 합니다.
- 보호 조건은 base/source/target의 합집합을 보존합니다. 배치는 살아남은 장면만 남기고 빠진 장면을 결정적으로 덧붙입니다.

봉인 요청은 서버가 발급한 `previewHash`와 충돌별 `resolutions`를 보냅니다. 서버는 preview hash를 다시 계산하고 source head/workspace와 target head/workspace가 미리보기 이후 바뀌지 않았는지 확인합니다. 성공하면 source·target·공통 base·해소 값·보호 요구에 묶인 atomic 병합 변경 세트를 만들며 source 분기는 수정하지 않습니다.

봉인된 변경 세트 역시 앞의 명시적 채택 절차를 거칩니다. 채택 후 새 target snapshot에는 source 조상 정보가 기록됩니다. 병합 변경 세트는 부분 파생할 수 없습니다.

## V1 호환성과 제한

기존 V1 후보 생성·commit·reject 경로는 기존 API 소비자와 저장 데이터 호환을 위해 유지됩니다. 새 UI에서는 V1 후보를 직접 채택하지 않고 `POST /api/candidates/{id}/promote`로 승격한 뒤 V2 검토를 수행합니다. 승격은 legacy candidate hash와 기준 맥락을 확인하며 오래된 제안은 채택 불가 상태로 남습니다. V1 commit은 기존 승인 정책을 유지하므로 V2의 `reviewedKeys` 정책과 동일하지 않습니다.

현재 구현의 경계는 다음과 같습니다.

- UI용 `/api`/camelCase 계약이며 명세의 전체 `/v1/projects/{project_id}`/snake_case 리소스 API가 아닙니다.
- 단일 사용자 작업실이며 인증, 역할별 ACL, 실시간 공동 편집을 제공하지 않습니다.
- PostgreSQL에서도 정규화된 artifact/revision/graph 테이블이 아니라 JSONB 집계 문서를 저장합니다.
- 영향 분석과 충돌 분류는 보수적 구조 검사이지 서사 의미의 형식 증명이 아닙니다.
- 전체 명세 M0–M3 완료 또는 AT-01–28 전체 통과를 주장하지 않습니다.
- 실제 유료 모델과 전체 동시성·성능 스트레스는 검증하지 않았습니다.
