import { AlertTriangle, Check, ClipboardCopy } from "lucide-react"
import { useState } from "react"
import type { SafeRunSummary } from "../../packages/execution/contracts.ts"
import { buildSafeDiagnosticLog, diagnosticStageLabel, retryGuidance } from "../runtime-diagnostics"

type Props = Readonly<{
  run: SafeRunSummary
}>

export function RunFailureDiagnostics({ run }: Props) {
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "failed">("idle")
  const error = run.error
  if (error === undefined) return null
  const diagnostics = error.diagnostics
  const safeLog = buildSafeDiagnosticLog(run)
  const copy = () => navigator.clipboard.writeText(JSON.stringify(safeLog, null, 2)).then(
    () => setCopyStatus("copied"),
    () => setCopyStatus("failed"),
  )

  return <section className="runtime-diagnostics" aria-labelledby="runtime-diagnostics-title">
    <header>
      <span className="runtime-diagnostics-icon" aria-hidden="true"><AlertTriangle /></span>
      <div>
        <p className="overline">SAFE FAILURE DIAGNOSTICS</p>
        <h4 id="runtime-diagnostics-title">실행 실패 진단</h4>
        <p><strong>{error.code}</strong>{error.message}</p>
      </div>
    </header>
    {diagnostics === undefined
      ? <p className="runtime-diagnostics-legacy">이전 기록 상세 진단 없음</p>
      : <>
        <dl>
          <div><dt>실패 단계</dt><dd>{diagnosticStageLabel(diagnostics.stage)}<code>{diagnostics.stage}</code></dd></div>
          <div><dt>HTTP 상태</dt><dd>{diagnostics.providerStatus ?? "기록 없음"}</dd></div>
          <div><dt>제공자 코드</dt><dd><code>{diagnostics.providerCode ?? "기록 없음"}</code></dd></div>
          <div><dt>요청 ID</dt><dd><code>{diagnostics.requestId ?? "기록 없음"}</code></dd></div>
          <div><dt>재시도 가능</dt><dd>{diagnostics.retryable ? "가능" : "불가"}</dd></div>
          <div><dt>원인 분류</dt><dd><code>{diagnostics.reasonCode}</code></dd></div>
          <div><dt>실행 ID</dt><dd><code>{run.id}</code></dd></div>
          <div><dt>선택 모델</dt><dd><code>{run.selectedModel ?? "기록 없음"}</code></dd></div>
          <div><dt>런타임 출처</dt><dd>{run.runtime ? `${run.runtime.name} ${run.runtime.version} · ${run.runtime.mode}` : "기록 없음"}</dd></div>
        </dl>
        <p className="runtime-retry-guidance">{retryGuidance(diagnostics.retryable)}</p>
      </>}
    <details>
      <summary>복사될 안전한 로그 미리보기</summary>
      <pre>{JSON.stringify(safeLog, null, 2)}</pre>
    </details>
    <footer>
      <p>입력 원문, API 키, 요청 헤더, 원시 제공자 응답은 포함하지 않습니다.</p>
      <button className="button quiet" type="button" onClick={() => void copy()}>
        {copyStatus === "copied" ? <Check /> : <ClipboardCopy />}
        {copyStatus === "copied" ? "복사됨" : "진단 로그 복사"}
      </button>
    </footer>
    <p className="sr-only" aria-live="polite">{copyStatus === "copied" ? "안전한 진단 로그를 복사했습니다." : copyStatus === "failed" ? "진단 로그를 복사하지 못했습니다." : ""}</p>
  </section>
}
