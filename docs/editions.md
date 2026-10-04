# 스냅샷 내보내기와 불변 판본

## 의미와 범위

스냅샷은 사람이 채택한 작업 원고의 고정된 선택 집합입니다. 판본은 선택한 스냅샷의 제목·부제·장면 순서·원문을 별도로 보존한 기록입니다. **판본 발행은 NOVAIL 작업실 내부 보관**이며 외부 출판·업로드·공개를 수행하지 않습니다.

판본 생성은 주 작업본의 head를 바꾸지 않습니다. 이후 원고 편집, 후보 채택, 복원, 다른 작품으로 전환해도 기존 판본은 변경되지 않습니다. 판본 수정·삭제·덮어쓰기 API는 제공하지 않습니다. 개정판은 기존 판본을 참조하는 새 레코드입니다.

현재 권한 모델은 README의 단일 사용자 로컬 Owner 모드입니다. 이 기능이 다중 사용자 인증·권한 검사를 구현한 것은 아닙니다.

## API

변경 요청에는 UUID `Idempotency-Key`가 필요합니다. GET은 판본을 만들거나 원고를 변경하지 않습니다.

새 변경 요청은 `X-Novail-Branch-Id`로 검토한 분기를 지정하고, 멱등 기록도 작품·분기에 묶습니다. 판본 발행은 선택한 분기의 스냅샷만 사용할 수 있지만 이미 발행한 판본은 작품 전체에서 읽을 수 있습니다. 구버전의 헤더 없는 단일 분기 호환 정책은 `branches.md`를 참조하세요.

| 경로 | 동작 |
|---|---|
| `GET /api/export-preview?snapshotId=...` | 선택 snapshot의 manifest, 장면 목록·분량, 최근 판본 조회 |
| `GET /api/export?snapshotId=...&format=markdown` | 선택 snapshot의 원고 다운로드 |
| `GET /api/export?format=docx` | 현재 head의 DOCX 다운로드 |
| `GET /api/export?snapshotId=...&format=manifest` | 선택 snapshot의 원문 hash와 순서 정보 다운로드 |
| `POST /api/editions` | 명시 승인에 따라 새 판본 기록 |
| `GET /api/editions` | 현재 작품의 판본 목록 |
| `GET /api/editions/{id}` | 판본 요약과 고정된 manifest |
| `GET /api/editions/{id}/export?format=docx` | 해당 불변 판본에서 다운로드 생성 |

내보내기 형식은 `markdown`, `docx`, `manifest`입니다. 형식 생략 시 Markdown, snapshot 생략 시 현재 head를 사용합니다. 저장된 draft workspace나 미채택 후보는 내보내지 않습니다.

```json
{
  "title": "초판",
  "snapshotId": "<선택한 snapshot id>",
  "expectedHead": "<검토 시작 시점의 head>",
  "approvedManifestHash": "<미리보기의 SHA-256>",
  "revisionOf": null,
  "approvedPreviousManifestHash": null,
  "decision": "publish",
  "policyVersion": 1
}
```

이미 판본이 있으면 `revisionOf`와 `approvedPreviousManifestHash`에 미리보기의 `latestEdition.id`와 `latestEdition.manifestHash`를 넣어야 합니다. 가장 최근 판본을 확인하지 않은 요청은 거절합니다. 따라서 두 창에서 동시에 동일한 이전 판본을 승인해도 먼저 처리된 요청 이후의 요청은 재검토해야 합니다.

## 승인과 보존

- 미리보기 hash는 프로젝트 ID, snapshot ID, 제목·부제, 장면 순서·제목·번호·원문 SHA-256·분량을 포함한 canonical JSON에 묶입니다.
- 발행 시 동일 내용을 다시 계산하고 승인 hash와 비교합니다. 예상 head가 달라졌다면 `STALE_HEAD`, 내용 hash가 다르면 `APPROVAL_MISMATCH`를 반환합니다.
- 이전 판본 승인이 없거나 오래되었으면 `EDITION_APPROVAL_REQUIRED`로 거절합니다.
- 원문이 없는 빈 snapshot은 `EMPTY_MANUSCRIPT`로 거절합니다.
- 판본 데이터, 명시 승인 이벤트, 발행 감사와 outbox 이벤트는 동일한 저장 트랜잭션에서 기록합니다.
- 판본 내보내기는 현재 원고가 아니라 저장된 판본 문서를 읽습니다. 원문 또는 manifest의 무결성 오류는 `EDITION_INTEGRITY_ERROR`로 노출합니다.
- 작품 전환 시 판본 컬렉션을 작품과 함께 보존하며 다른 작품의 판본 ID는 조회할 수 없습니다.
- 분기를 바꿔도 발행 판본은 유지하며, 새로운 판본의 `sourceBranchId`에 출처를 기록합니다. 기존 판본의 hash에는 새 필드를 소급 적용하지 않습니다.
- UI는 승인 화면을 연 시점의 head를 유지합니다. 실패했다고 최신 head로 승인을 몰래 바꾸지 않습니다.

## 문서 형식

DOCX는 `docx` 패키지의 OOXML 문서이며 표제, 부제, 장 제목, 문단, 문단 내 줄바꿈을 저장합니다. 바탕 계열 글꼴을 지정하지만 글꼴 파일은 문서에 포함하지 않으므로 수신 환경에 따라 대체 글꼴이 사용될 수 있습니다.

파일명은 `novail-edition-<id>.docx`처럼 ASCII 식별자와 확장자를 사용합니다. 한국어 원고 제목은 문서 및 manifest에 그대로 보존합니다. 일부 Chromium 환경에서 UTF-8 Content-Disposition 파일명을 `download`로 처리하는 현상을 피하기 위한 상호운용 정책입니다.

원문 hash와 내용의 재현성을 보장 대상으로 삼습니다. ZIP 메타데이터 등의 차이 때문에 DOCX 파일 바이트 전체가 매번 동일하다고 보장하지 않습니다. 잘못된 Unicode는 내보내기·발행을 거절하며, XML에서 표현할 수 없는 제어 문자는 DOCX에서 명시적으로 오류를 반환합니다. 원문을 조용히 삭제하거나 바꾸지 않습니다.
