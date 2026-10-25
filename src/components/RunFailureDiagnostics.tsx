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
        <h4 id="runtime-diagnostics-title">Run failure diagnostics</h4>
        <p><strong>{error.code}</strong>{error.message}</p>
      </div>
    </header>
    {diagnostics === undefined
      ? <p className="runtime-diagnostics-legacy">No detailed diagnostics for this legacy record</p>
      : <>
        <dl>
          <div><dt>Failure stage</dt><dd>{diagnosticStageLabel(diagnostics.stage)}<code>{diagnostics.stage}</code></dd></div>
          <div><dt>HTTP status</dt><dd>{diagnostics.providerStatus ?? "Not recorded"}</dd></div>
          <div><dt>Provider code</dt><dd><code>{diagnostics.providerCode ?? "Not recorded"}</code></dd></div>
          <div><dt>Request ID</dt><dd><code>{diagnostics.requestId ?? "Not recorded"}</code></dd></div>
          <div><dt>Retryable</dt><dd>{diagnostics.retryable ? "Yes" : "No"}</dd></div>
          <div><dt>Reason code</dt><dd><code>{diagnostics.reasonCode}</code></dd></div>
          <div><dt>Run ID</dt><dd><code>{run.id}</code></dd></div>
          <div><dt>Selected model</dt><dd><code>{run.selectedModel ?? "Not recorded"}</code></dd></div>
          <div><dt>Runtime provenance</dt><dd>{run.runtime ? `${run.runtime.name} ${run.runtime.version} · ${run.runtime.mode}` : "Not recorded"}</dd></div>
        </dl>
        <p className="runtime-retry-guidance">{retryGuidance(diagnostics.retryable)}</p>
      </>}
    <details>
      <summary>Preview safe log to be copied</summary>
      <pre>{JSON.stringify(safeLog, null, 2)}</pre>
    </details>
    <footer>
      <p>Excludes source input, API keys, request headers, and raw provider responses.</p>
      <button className="button quiet" type="button" onClick={() => void copy()}>
        {copyStatus === "copied" ? <Check /> : <ClipboardCopy />}
        {copyStatus === "copied" ? "Copied" : "Copy diagnostic log"}
      </button>
    </footer>
    <p className="sr-only" aria-live="polite">{copyStatus === "copied" ? "Safe diagnostic log copied." : copyStatus === "failed" ? "Could not copy the diagnostic log." : ""}</p>
  </section>
}
