import { AlertTriangle, Clock3, LockKeyhole, PencilLine, Quote } from "lucide-react"
import type { EvaluationReportsResponse } from "../../packages/revision/evaluation-contracts.ts"
import { formulationLabel } from "../evaluation-draft.ts"

type HistoryItem = EvaluationReportsResponse["history"][number]
type Check = EvaluationReportsResponse["mechanicalPreview"][number]
type Criteria = EvaluationReportsResponse["defaultCriteria"]

export const verdictLabel = (verdict: "fulfilled" | "violated" | "unknown"): string => verdict === "fulfilled" ? "Fulfilled" : verdict === "violated" ? "Violated" : "Unknown"
const checkLabels: Readonly<Record<Check["id"], string>> = { integrity: "Integrity", workspace_schema: "Workspace schema", protected_content: "Protected content", temporal: "Time constraints" }
const checkVerdict = (verdict: Check["verdict"]): string => verdict === "pass" ? "Pass" : verdict === "fail" ? "Fail" : "Unknown"

export function MechanicalChecks({ checks, compact = false }: Readonly<{ checks: readonly Check[]; compact?: boolean }>) {
  return <div className={`mechanical-checks ${compact ? "compact" : ""}`}>{checks.map((check) => <article key={check.id} className={check.verdict}><div><strong>{checkLabels[check.id]}</strong><span>{checkVerdict(check.verdict)}</span></div><p>{check.id === "temporal" && check.code === "NO_STRUCTURED_TEMPORAL_CONSTRAINTS" ? "No structured time constraints" : check.message}</p><code>{check.code}</code></article>)}</div>
}

export function EvaluationHistory({ history, disabled, onEdit }: Readonly<{ history: readonly HistoryItem[]; disabled: boolean; onEdit: (criteria: Criteria) => void }>) {
  return <section className="evaluation-history" aria-labelledby="evaluation-history-title"><header><div><p className="overline">IMMUTABLE EVALUATION LEDGER</p><h4 id="evaluation-history-title">Evaluation report history</h4></div><span>{history.length}</span></header>
    {history.length === 0 ? <div className="empty-review"><Clock3 /><strong>No saved evaluation reports</strong><p>Save the first human evaluation to begin an immutable history here.</p></div> : history.toReversed().map((item, index) => <HistoryCard key={item.valid ? item.report.id : `${item.reportId ?? "corrupt"}:${index}`} item={item} disabled={disabled} onEdit={onEdit} />)}
  </section>
}

function HistoryCard({ item, disabled, onEdit }: Readonly<{ item: HistoryItem; disabled: boolean; onEdit: (criteria: Criteria) => void }>) {
  if (!item.valid) return <article className="corrupt-report" role="alert"><AlertTriangle /><div><strong>Corrupt report envelope</strong><p>This record cannot be trusted, so its contents are not displayed.</p><code>{item.reportId ?? "No report identifier"}</code><ul>{item.invalidReasons.map((reason) => <li key={reason}>{reason}</li>)}</ul></div></article>
  const report = item.report
  return <article className="evaluation-report-card"><header>
    <div>
      <span><LockKeyhole /> Report r{report.revision}</span>
      <strong>{verdictLabel(report.humanVerdict)}</strong>
      {!item.current ? <em>Differs from current criteria</em> : null}
    </div>
    <div className="history-report-actions">
      <small>{new Date(report.createdAt).toLocaleString("en-US")} · Human · Local owner</small>
      <button className="button quiet compact" type="button" disabled={disabled} onClick={() => onEdit(report.criteria)}><PencilLine /> Edit as new revision</button>
    </div>
  </header>
    {!item.evidenceValid ? <aside className="evaluation-warning danger report-integrity" role="alert"><AlertTriangle /><div><strong>Report contents are preserved, but the evidence cannot currently be verified</strong><ul>{item.invalidReasons.map((reason) => <li key={reason}>{reason}</li>)}</ul></div></aside> : null}
    {!item.current ? <aside className="evaluation-warning report-integrity"><AlertTriangle /><div><strong>The saved criteria differ from the current criteria</strong>{item.evidenceValid && item.invalidReasons.length > 0 ? <ul>{item.invalidReasons.map((reason) => <li key={reason}>{reason}</li>)}</ul> : null}</div></aside> : null}
    <dl><div><dt>Observed head</dt><dd><code>{report.observedHead}</code></dd></div><div><dt>Workspace hash</dt><dd><code>{report.observedWorkspaceHash}</code></dd></div></dl>
    <MechanicalChecks checks={report.mechanicalChecks} compact />
    <div className="history-criteria">{report.criteria.map((criterion) => <section key={criterion.id}>
      <header>
        <div><span className={`formulation ${criterion.formulation}`}>{formulationLabel(criterion.formulation)}</span><strong>{criterion.text}</strong></div>
        <span>{verdictLabel(criterion.verdict)}</span>
      </header>
      <p>{criterion.rationale}</p>
      <div className="criterion-basis" aria-label="Evaluation criterion evidence">
        {criterion.basisRefs.length === 0 ? <small>Human-authored · No linked evidence</small> : criterion.basisRefs.map((basis, index) => <article key={`${basis.kind}:${basis.kind === "feedback" ? basis.feedbackId : "reason"}:${basis.sourceHash}:${basis.startCp}:${index}`}>
          <strong>{basis.kind === "feedback" ? "Feedback evidence" : "Change set reason evidence"}</strong>
          {basis.kind === "feedback" ? <span>Feedback ID <code>{basis.feedbackId}</code></span> : null}
          <blockquote>{basis.quote}</blockquote>
          <small>Code points {basis.startCp}–{basis.endCp} · source hash <code>{basis.sourceHash}</code></small>
        </article>)}
      </div>
      {criterion.citations.map((citation, index) => <blockquote key={`${citation.entryId}:${citation.startCp}:${index}`}>
        <Quote /><span>{citation.quote}</span>
        <small>{citation.side} · {citation.field} · {citation.startCp}–{citation.endCp} · source hash <code>{citation.sourceHash}</code></small>
      </blockquote>)}
    </section>)}</div>
  </article>
}
