import type { SafeRunSummary } from "../packages/execution/contracts.ts"

type FailureDiagnostics = NonNullable<NonNullable<SafeRunSummary["error"]>["diagnostics"]>

const stageLabels = {
  provider_transport: "Provider connection failed",
  provider_http: "Provider request rejected",
  provider_response: "Provider response error",
  output_json: "Result JSON parsing failed",
  output_shape: "Result shape mismatch",
  output_scope: "Allowed scope mismatch",
  output_truncated: "Result output truncated",
} as const satisfies Readonly<Record<FailureDiagnostics["stage"], string>>

export function diagnosticStageLabel(stage: FailureDiagnostics["stage"]): string {
  return stageLabels[stage]
}

export function retryGuidance(retryable: boolean): string {
  return retryable
    ? "This may be temporary. You can retry the same run shortly."
    : "Retrying with the same settings will not resolve this. Check the model and API protocol configuration."
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
