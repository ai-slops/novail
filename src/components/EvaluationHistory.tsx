import { AlertTriangle, Clock3, LockKeyhole, PencilLine, Quote } from "lucide-react"
import type { EvaluationReportsResponse } from "../../packages/revision/evaluation-contracts.ts"
import { formulationLabel } from "../evaluation-draft.ts"

type HistoryItem = EvaluationReportsResponse["history"][number]
type Check = EvaluationReportsResponse["mechanicalPreview"][number]
type Criteria = EvaluationReportsResponse["defaultCriteria"]

export const verdictLabel = (verdict: "fulfilled" | "violated" | "unknown"): string => verdict === "fulfilled" ? "충족" : verdict === "violated" ? "위반" : "알 수 없음"
const checkLabels: Readonly<Record<Check["id"], string>> = { integrity: "무결성", workspace_schema: "작업 공간 스키마", protected_content: "보호 문장", temporal: "시간 제약" }
const checkVerdict = (verdict: Check["verdict"]): string => verdict === "pass" ? "통과" : verdict === "fail" ? "실패" : "알 수 없음"

export function MechanicalChecks({ checks, compact = false }: Readonly<{ checks: readonly Check[]; compact?: boolean }>) {
  return <div className={`mechanical-checks ${compact ? "compact" : ""}`}>{checks.map((check) => <article key={check.id} className={check.verdict}><div><strong>{checkLabels[check.id]}</strong><span>{checkVerdict(check.verdict)}</span></div><p>{check.id === "temporal" && check.code === "NO_STRUCTURED_TEMPORAL_CONSTRAINTS" ? "구조화된 시간 제약 없음" : check.message}</p><code>{check.code}</code></article>)}</div>
}

export function EvaluationHistory({ history, disabled, onEdit }: Readonly<{ history: readonly HistoryItem[]; disabled: boolean; onEdit: (criteria: Criteria) => void }>) {
  return <section className="evaluation-history" aria-labelledby="evaluation-history-title"><header><div><p className="overline">IMMUTABLE EVALUATION LEDGER</p><h4 id="evaluation-history-title">평가 보고서 이력</h4></div><span>{history.length}</span></header>
    {history.length === 0 ? <div className="empty-review"><Clock3 /><strong>저장된 평가 보고서가 없습니다</strong><p>첫 수동 평가를 저장하면 변경할 수 없는 이력이 이곳에 쌓입니다.</p></div> : history.toReversed().map((item, index) => <HistoryCard key={item.valid ? item.report.id : `${item.reportId ?? "corrupt"}:${index}`} item={item} disabled={disabled} onEdit={onEdit} />)}
  </section>
}

function HistoryCard({ item, disabled, onEdit }: Readonly<{ item: HistoryItem; disabled: boolean; onEdit: (criteria: Criteria) => void }>) {
  if (!item.valid) return <article className="corrupt-report" role="alert"><AlertTriangle /><div><strong>손상된 보고서 봉투</strong><p>이 기록은 신뢰할 수 없어 내용으로 표시하지 않습니다.</p><code>{item.reportId ?? "보고서 식별자 없음"}</code><ul>{item.invalidReasons.map((reason) => <li key={reason}>{reason}</li>)}</ul></div></article>
  const report = item.report
  return <article className="evaluation-report-card"><header><div><span><LockKeyhole /> 보고서 r{report.revision}</span><strong>{verdictLabel(report.humanVerdict)}</strong>{!item.current ? <em>현재 기준과 다름</em> : null}</div><div className="history-report-actions"><small>{new Date(report.createdAt).toLocaleString("ko-KR")} · 사람 · 로컬 소유자</small><button className="button quiet compact" type="button" disabled={disabled} onClick={() => onEdit(report.criteria)}><PencilLine /> 새 개정으로 편집</button></div></header>
    {!item.evidenceValid ? <aside className="evaluation-warning danger report-integrity" role="alert"><AlertTriangle /><div><strong>보고서 내용은 보존되지만 근거를 현재 확인할 수 없습니다</strong><ul>{item.invalidReasons.map((reason) => <li key={reason}>{reason}</li>)}</ul></div></aside> : null}
    {!item.current ? <aside className="evaluation-warning report-integrity"><AlertTriangle /><div><strong>저장 당시 기준과 현재 기준이 다릅니다</strong>{item.evidenceValid && item.invalidReasons.length > 0 ? <ul>{item.invalidReasons.map((reason) => <li key={reason}>{reason}</li>)}</ul> : null}</div></aside> : null}
    <dl><div><dt>관찰 head</dt><dd><code>{report.observedHead}</code></dd></div><div><dt>작업 공간 hash</dt><dd><code>{report.observedWorkspaceHash}</code></dd></div></dl>
    <MechanicalChecks checks={report.mechanicalChecks} compact />
    <div className="history-criteria">{report.criteria.map((criterion) => <section key={criterion.id}><header><div><span className={`formulation ${criterion.formulation}`}>{formulationLabel(criterion.formulation)}</span><strong>{criterion.text}</strong></div><span>{verdictLabel(criterion.verdict)}</span></header><p>{criterion.rationale}</p><div className="criterion-basis" aria-label="평가 기준 근거">{criterion.basisRefs.length === 0 ? <small>사람이 직접 작성 · 연결 근거 없음</small> : criterion.basisRefs.map((basis, index) => <article key={`${basis.kind}:${basis.kind === "feedback" ? basis.feedbackId : "reason"}:${basis.sourceHash}:${basis.startCp}:${index}`}><strong>{basis.kind === "feedback" ? "피드백 근거" : "변경 제안 사유 근거"}</strong>{basis.kind === "feedback" ? <span>피드백 ID <code>{basis.feedbackId}</code></span> : null}<blockquote>{basis.quote}</blockquote><small>코드포인트 {basis.startCp}–{basis.endCp} · 원문 hash <code>{basis.sourceHash}</code></small></article>)}</div>{criterion.citations.map((citation, index) => <blockquote key={`${citation.entryId}:${citation.startCp}:${index}`}><Quote /><span>{citation.quote}</span><small>{citation.side} · {citation.field} · {citation.startCp}–{citation.endCp} · 원문 hash <code>{citation.sourceHash}</code></small></blockquote>)}</section>)}</div>
  </article>
}
