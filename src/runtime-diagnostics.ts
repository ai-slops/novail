import type { SafeRunSummary } from "../packages/execution/contracts.ts"

type FailureDiagnostics = NonNullable<NonNullable<SafeRunSummary["error"]>["diagnostics"]>

const stageLabels = {
  provider_transport: "제공자 연결 실패",
  provider_http: "제공자 요청 거절",
  provider_response: "제공자 응답 오류",
  output_json: "결과 JSON 해석 실패",
  output_shape: "결과 형식 불일치",
  output_scope: "허용 범위 불일치",
  output_truncated: "결과 출력 잘림",
} as const satisfies Readonly<Record<FailureDiagnostics["stage"], string>>

export function diagnosticStageLabel(stage: FailureDiagnostics["stage"]): string {
  return stageLabels[stage]
}

export function retryGuidance(retryable: boolean): string {
  return retryable
    ? "일시적인 문제일 수 있습니다. 잠시 뒤 같은 실행을 다시 시도할 수 있습니다."
    : "같은 설정으로 다시 실행해도 해결되지 않습니다. 모델과 API 프로토콜 설정을 확인하세요."
}

export function buildSafeDiagnosticLog(run: SafeRunSummary) {
  const diagnostics = run.error?.diagnostics
  return {
    runId: run.id,
    state: run.state,
    ...(run.selectedModel === undefined ? {} : { model: run.selectedModel }),
    ...(run.runtime === undefined ? {} : { runtime: {
      name: run.runtime.name,
      version: run.runtime.version,
      mode: run.runtime.mode,
    } }),
    usageKnown: run.usage.known,
    ...(run.error === undefined ? {} : { error: {
      code: run.error.code,
      ...(diagnostics === undefined ? {} : {
        stage: diagnostics.stage,
        ...(diagnostics.providerStatus === undefined ? {} : { providerStatus: diagnostics.providerStatus }),
        ...(diagnostics.providerCode === undefined ? {} : { providerCode: diagnostics.providerCode }),
        ...(diagnostics.requestId === undefined ? {} : { requestId: diagnostics.requestId }),
        retryable: diagnostics.retryable,
        reasonCode: diagnostics.reasonCode,
      }),
    } }),
  }
}
