# Router4U로 개인 Codex 계정 연결

이 절차는 Router4U의 `personal` 연결을 통해 NOVAIL 개발 서버에서 실제 모델을 선택적으로 사용하는 방법입니다. 계정 연결, 준비 상태 확인, 실제 추론은 서로 다른 단계입니다. 로그인이나 모델 목록 조회가 실제 추론 성공 또는 모델 사용 권한을 보장하지 않습니다.

## 1. Router4U 설치와 접속

Linux amd64 Docker 호스트에서 검증한 업스트림 소스를 고정해 빌드합니다.

```sh
git clone https://github.com/slop-lab/router4u.git
cd router4u
git checkout a6709ad6e892d4b26bd7d7cf611a76b29436c0a0
docker build --platform linux/amd64 -t router4u:novail-a6709ad6 .
docker run -d --name novail-router4u --restart unless-stopped --stop-timeout 30 \
  --read-only --tmpfs /tmp \
  --log-driver json-file --log-opt max-size=10m --log-opt max-file=3 \
  -p 127.0.0.1:9470:9470 \
  -v novail-router4u-data:/var/lib/router4u \
  -v novail-router4u-transcripts:/var/lib/router4u-transcripts \
  router4u:novail-a6709ad6
docker inspect --format '{{.State.Status}} / {{.State.Health.Status}}' novail-router4u
```

`running / healthy`가 될 때까지 기다립니다. 컨테이너 ID가 출력된 것만으로 초기화 성공을 판단하지 않습니다. 로컬에서는 `http://127.0.0.1:9470/`을 엽니다.

DIM에서는 `dim-development-service expose --name router4u --port 9470 --ingress https-ts --require-scheme https`가 출력한 HTTPS URL을 사용합니다. 이 명령은 작업공간에서 접근 가능한 로컬 포트를 노출하므로 원격 Docker daemon을 사용한다면 먼저 로컬 브리지가 필요합니다. DIM 작업공간의 `/tmp` 기반 브리지와 노출은 재부팅 후 유지된다고 가정하지 말고 Router4U 상태를 확인한 뒤 다시 연결합니다. 내부 백엔드 포트 `8317`과 OAuth 콜백 포트 `1455`는 공개하지 않습니다.

관리자 키는 필요할 때 호스트에서 직접 조회합니다. 다음 명령의 실제 출력은 채팅, 이슈, 로그 또는 커밋에 붙이지 않습니다.

```sh
docker exec novail-router4u router4u admin-key show
```

관리자 키는 제어실 로그인 전용입니다. NOVAIL의 `OPENAI_API_KEY`로 사용하지 않습니다.

## 2. 개인 Codex 연결과 프로젝트 키

1. Router4U 제어실에서 **Connections → personal → Connect Codex**를 선택합니다.
2. 공급자 화면의 **Sign in with ChatGPT**로 본인 계정에 로그인합니다.
3. 브라우저가 `localhost:1455`로 이동한 뒤 페이지가 열리지 않으면 주소창의 전체 콜백 URL을 복사해 Router4U 대화상자에 직접 붙여 넣습니다. 콜백 URL은 채팅이나 저장소에 공유하지 않습니다.
4. **Set up models → Load available models**에서 모델을 조회하고 사용할 모델만 선택한 뒤 연결을 활성화합니다. 모델 조회만으로 entitlement가 검증되지는 않습니다.
5. **Projects & keys**에서 NOVAIL용 프로젝트를 만들고 라우트는 `personal` 하나만 허용합니다. NOVAIL 클라이언트는 `X-Router4u-Route` 헤더를 보내지 않으므로 여러 프로젝트 라우트를 허용하면 선택이 모호해집니다.
6. 프로젝트 키를 발급합니다. 기본 scope에는 `inference`와 `usage:read`가 포함됩니다. 이 프로젝트 키만 NOVAIL에 사용하며 관리자 키나 OAuth 자격 증명은 사용하지 않습니다.

Codex 연결은 본인이 소유한 개인 계정과 본인의 워크로드용입니다. 계정 접근을 다른 사람에게 제공하거나 자격 증명을 배포·재판매하지 말고 현재 공급자 약관과 제한을 직접 확인합니다.

## 3. NOVAIL 환경 설정

Node.js 24.22.x 이상인 24.x를 활성화하고 의존성을 설치한 뒤 비공개 환경 파일을 만듭니다.

```sh
cp .env.router4u.example .env.router4u
chmod 600 .env.router4u
pnpm install
```

`.env.router4u`를 직접 편집합니다.

```dotenv
OPENAI_BASE_URL=http://127.0.0.1:9470/v1
OPENAI_API_KEY=<Router4U project key>
OPENAI_MODEL=<exact model ID returned by Router4U discovery>
PORT=3002
NOVAIL_DATA_FILE=.data/router4u-state.json
```

- `OPENAI_MODEL`은 Router4U가 조회한 정확한 ID를 사용합니다. 임의의 GPT 기본값을 추측하지 않습니다.
- DIM처럼 Router4U가 다른 주소에 있다면 `OPENAI_BASE_URL`에 NOVAIL 서버에서 도달 가능한 게이트웨이 주소와 `/v1`을 씁니다. 브라우저용 제어실 URL과 서버가 도달할 주소가 다를 수 있습니다.
- `.env.router4u`는 gitignore 대상입니다. 프로젝트 키를 셸 기록, 채팅, 브라우저 클라이언트 코드 또는 커밋에 노출하지 않습니다.
- 기본 `NOVAIL_DATA_FILE`은 Router4U 검증 전용 시드 `.data/router4u-state.json`입니다. 기존 미리보기나 사용자 원고 상태를 읽거나 바꾸지 않습니다. 나중에 소유자가 백업을 만든 뒤 명시적으로 기존 파일을 선택할 수 있습니다.

현재 셸의 Node가 요구 버전보다 낮고 즉시 버전 관리자를 사용할 수 없을 때만 다음 형태로 검사를 실행할 수 있습니다. 표준 절차는 저장소의 `.node-version`인 Node 24.22.0을 활성화하는 것입니다.

```sh
npx --yes --package=node@24.22.0 --package=pnpm@12.5.1 pnpm router4u:check
```

## 4. 준비 상태와 실제 추론을 구분해 확인

먼저 읽기 전용 준비 상태를 확인합니다.

```sh
pnpm router4u:check
```

이 명령은 인증된 `GET /v1/models`와 `GET /v1/capabilities`만 호출합니다. 프로젝트 키, 선택 모델, Chat Completions·스트리밍·native tool passthrough 광고를 확인하지만 추론하지 않으며 strict JSON Schema, 실제 entitlement, 응답 품질을 증명하지 않습니다.

실제 공급자 호출과 quota 사용에 명시적으로 동의할 때만 생성 probe를 실행합니다.

```sh
pnpm router4u:check --generate
```

`--generate`는 임시 디렉터리의 기본 시드로 격리된 Part run을 만들고 NOVAIL의 읽기 전용 도구, 스트리밍, tool loop와 strict JSON Schema 결과 경로를 확인한 뒤 임시 상태를 삭제합니다. 실제 사용자 파일과 정본 head는 건드리지 않지만 공급자 quota는 사용할 수 있습니다. 출력이 시드와 의미상 같으면 `NO_CHANGES` 검증 issue로 채택이 차단될 수 있으며, 이는 연결 probe에서 의도된 결과일 수 있습니다. 오류는 실패로 남고 로컬 예제 결과로 대체되지 않습니다. 이 probe는 연결 호환성 확인이지 문학 품질, 실제 사용자 워크플로 채택, 일반적인 모델 신뢰성 평가가 아닙니다.

## 5. NOVAIL 시작과 노출

`start:router4u`는 base URL, 프로젝트 키 또는 모델이 빠지면 로컬 예제 모드로 내려가지 않고 시작을 실패시킵니다.

```sh
pnpm start:router4u
```

`.env.router4u.example`의 기본 포트는 `3001`입니다. 해당 포트를 소유한 기존 미리보기가 있으면 그 프로세스의 소유권을 확인해 정상 종료하거나, 위 예시처럼 `PORT=3002`를 선택합니다. 모든 Node 프로세스를 일괄 종료하지 않습니다.

DIM에서는 별도 터미널에서 선택한 포트를 노출하고 도구가 출력한 실제 URL을 사용합니다.

```sh
dim-development-service expose --name novail-router4u --port 3002 --ingress https-ts --require-scheme https
```

서버를 연 뒤 웹 UI에서 Run을 직접 생성해야 실제 사용자 흐름의 추론이 발생합니다. 준비 검사 통과만으로 실제 Run이 수행된 것은 아닙니다.

## 6. 수명주기와 데이터 책임

```sh
docker stop -t 30 novail-router4u
docker start novail-router4u
docker inspect --format '{{.State.Status}} / {{.State.Health.Status}}' novail-router4u
```

컨테이너 stop/start는 `novail-router4u-data`와 `novail-router4u-transcripts` named volume을 보존합니다. 컨테이너를 교체할 때도 두 volume을 모두 다시 연결하며 동시에 두 설치가 같은 volume을 사용하게 하지 않습니다. 첫 volume에는 Router4U 설정, 키, OAuth 자격 증명과 운영 상태가 있고 transcript volume에는 원고가 포함될 수 있는 요청·응답 본문과 감사 기록이 있습니다. 둘 다 민감 정보로 취급하고 삭제·복원·이전 전에 정지 상태에서 함께 백업합니다.

컨테이너가 healthy여도 계정 로그인, 라우트 활성화, 모델 선택, 프로젝트 정책 또는 실제 추론이 성공했다는 뜻은 아닙니다. 재부팅 후에는 Docker health, 임시 브리지, DIM 노출, NOVAIL 준비 검사를 각각 다시 확인합니다.
