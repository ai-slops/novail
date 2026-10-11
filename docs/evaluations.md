# 근거 기반 사람 평가 계약

## 목적과 경계

평가 보고서는 하나의 고정된 V2 변경 세트에 대해 사람이 작성하는 추가 전용(append-only) 판단 기록입니다. 평가 화면은 모델을 실행하지 않고, 영향 검토를 승인하지 않으며, 변경 세트를 채택하거나 branch head를 바꾸지 않습니다. **평가와 채택은 서로 다른 결정**입니다.

현재 작성자는 `human / local-owner`로 고정된 단일 사용자 작업실입니다. 별도 자동 LLM Evaluator는 구현되어 있지 않습니다. `fulfilled`, `violated`, `unknown`은 사람이 기준별로 선택한 값에서 계산되는 보고서 상태이며 모델의 자동 판정이 아닙니다.

## 평가 근거와 정확한 인용

연결된 피드백이 있으면 모든 피드백 원문이 필수 출처입니다. 연결된 피드백이 없으면 변경 세트의 제안 사유가 필수 출처입니다. 기본 기준은 출처 전체를 그대로 사용하고 다음 provenance를 보존합니다.

- 출처 종류: `feedback` 또는 `change_set_reason`
- 피드백 출처의 `feedbackId`
- 출처 전체의 SHA-256 `sourceHash`
- Unicode code point 기준 `startCp`, `endCp`
- 해당 범위와 정확히 일치하는 `quote`
- 기준 작성 방식: `verbatim_source`, `human_refinement`, `human_authored`

`verbatim_source`는 정확히 하나의 출처와 동일한 문구여야 합니다. 출처를 바탕으로 사람이 다듬은 기준은 원래 근거를 유지한 `human_refinement`가 됩니다. 사람이 새로 작성한 `human_authored` 기준은 출처 근거가 있다고 주장하지 않으므로 `basisRefs`가 비어 있어야 합니다. 연결된 원문이 사라졌다면 임의로 복원하지 않고 출처를 사용할 수 없다고 표시합니다.

판단 인용은 고정된 변경 항목의 `before` 또는 `after`에서만 만듭니다. 인용 가능한 필드는 `text`, `summary`, `storyTime`, `description`이며, 전체 필드의 hash와 code-point 범위 및 정확한 원문을 함께 저장합니다. 서버는 저장 시 출처 hash와 범위를 다시 계산합니다. 알려진 판단인 `fulfilled` 또는 `violated`에는 비어 있지 않은 rationale과 하나 이상의 정확한 인용이 필요합니다. `unknown`도 rationale을 기록하지만 인용은 생략할 수 있습니다.

## 사람 판단의 집계

보고서의 `humanVerdict`는 다음 순서로 결정합니다.

1. 기준 하나라도 `violated`이면 전체는 `violated`입니다.
2. 모든 기준이 `fulfilled`이고, 모든 필수 출처가 사용 가능하며 하나 이상의 기준 근거로 표현되었으면 전체는 `fulfilled`입니다.
3. 그 밖의 경우는 `unknown`입니다.

따라서 출처가 없거나 일부 기준이 아직 평가되지 않았다는 이유로 시스템이 통과를 추정하지 않습니다.

## 기계 검사

각 보고서는 저장 당시의 네 가지 기계 검사를 함께 보존합니다.

| 검사 | 의미 |
| --- | --- |
| `integrity` | 변경 세트 schema, policy version, 불변 hash와 base binding 검사 |
| `workspace_schema` | 변경 적용 후 작업 공간 schema와 identity 검사 |
| `protected_content` | 보호 문장과 병합 보호 조건 보존 검사 |
| `temporal` | 구조화된 시간 제약 검사 |

각 결과는 `pass`, `fail`, `unknown` 중 하나와 안정적인 code, 설명, 관련 key를 가집니다. 현재 변경 세트에는 구조화된 시간 제약 매핑이 없으므로 `temporal`은 `NO_STRUCTURED_TEMPORAL_CONSTRAINTS`와 `unknown`입니다. 산문 속 시간 표현을 자동 해석해 통과로 바꾸지 않습니다. 기계 검사는 서사적 품질 판단이나 사람 평가를 대신하지 않습니다.

## 추가 전용 이력과 현재성

보고서 생성은 변경 세트 hash, 관찰한 head, 작업 공간 hash와 최신 보고서 ID를 비교한 뒤 수행합니다. 각 보고서는 이전 보고서의 ID와 hash를 `supersedes`로 참조하고 자체 hash를 가지며, 기존 보고서를 수정하거나 삭제하지 않습니다. 과거 보고서를 편집하면 그 내용을 바탕으로 새 개정을 추가합니다.

head, 작업 공간 또는 변경 세트 binding이 달라진 보고서는 삭제하지 않고 `current: false`인 이력으로 남깁니다. 현재 출처와 인용을 다시 확인할 수 없으면 `evidenceValid: false`와 원인을 표시하되 원래 내용을 보존합니다. schema, 자체 hash 또는 연결 chain이 손상된 봉투는 신뢰할 수 없는 내용으로 부분 렌더링하지 않습니다. 평가 기록이 남아 있다는 사실은 변경 세트의 채택 승인을 뜻하지 않습니다.

## API

- `GET /api/change-sets/{id}/evaluation-reports`: binding, 필수 출처, 기본 기준, 기계 검사 미리보기와 전체 이력을 조회합니다.
- `POST /api/change-sets/{id}/evaluation-reports`: `expectedChangeSetHash`, `expectedHead`, `expectedWorkspaceHash`, `expectedLatestReportId`, `criteria`를 제출해 새 보고서를 추가합니다.

변경 세트 hash, head, 작업 공간 hash 또는 최신 보고서 ID가 달라지면 오래된 화면의 저장을 거절하고 사용자가 현재 상태를 다시 검토하도록 합니다.
