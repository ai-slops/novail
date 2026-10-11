import { AlertTriangle, FileCheck2, LoaderCircle, Plus, RefreshCw, ShieldCheck } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import type { ChangeSet } from "../../packages/revision/contracts.ts"
import type { EvaluationCriterion, EvaluationReportsResponse } from "../../packages/revision/evaluation-contracts.ts"
import { ApiError, createEvaluationReport, getEvaluationReports } from "../api.ts"
import { evaluationDraftChanged, initialCriteria, validateCriterion } from "../evaluation-draft.ts"
import { EvaluationCriterionEditor } from "./EvaluationCriterionEditor.tsx"
import { EvaluationHistory, MechanicalChecks } from "./EvaluationHistory.tsx"

type Props = Readonly<{ changeSet: ChangeSet; branchId: string; onDirtyChange: (dirty: boolean) => void; onBeforeDiscard: () => boolean }>

export function EvaluationWorkspace({ changeSet, branchId, onDirtyChange, onBeforeDiscard }: Props) {
  const [projection, setProjection] = useState<EvaluationReportsResponse | null>(null)
  const [criteria, setCriteria] = useState<readonly EvaluationCriterion[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const sequence = useRef(0)
  const baselineCriteria = useRef<readonly EvaluationCriterion[]>([])

  const load = async () => {
    const request = ++sequence.current
    setLoading(true); setError(null); setSaved(false)
    try {
      const next = await getEvaluationReports(changeSet.id, branchId)
      if (request !== sequence.current) return
      const nextCriteria = initialCriteria(next.history, next.defaultCriteria)
      baselineCriteria.current = nextCriteria
      setProjection(next); setCriteria(nextCriteria); setDirty(false); onDirtyChange(false)
    } catch (cause: unknown) {
      if (request !== sequence.current) return
      setError(cause instanceof Error ? cause.message : "평가 자료를 불러오지 못했습니다.")
    } finally { if (request === sequence.current) setLoading(false) }
  }
  useEffect(() => { void load(); return () => { sequence.current += 1 } }, [changeSet.id, branchId])
  useEffect(() => { const changed = evaluationDraftChanged(baselineCriteria.current, criteria); setDirty(changed); onDirtyChange(changed) }, [criteria, onDirtyChange])

  const update = (id: string, next: EvaluationCriterion) => { setCriteria((current) => current.map((item) => item.id === id ? next : item)); setSaved(false) }
  const add = () => { setCriteria((current) => [...current, { id: crypto.randomUUID(), text: "", formulation: "human_authored", basisRefs: [], verdict: "unknown", rationale: "아직 사람이 평가하지 않았습니다.", citations: [] }]); setSaved(false) }
  const reload = () => { if (onBeforeDiscard()) void load() }
  const save = async () => {
    if (!projection || saving) return
    const invalid = criteria.flatMap(validateCriterion)
    if (criteria.length === 0 || invalid.length > 0) { setError(criteria.length === 0 ? "평가 기준을 하나 이상 추가하세요." : "표시된 기준 오류를 먼저 해결하세요."); return }
    setSaving(true); setError(null); setSaved(false)
    try {
      await createEvaluationReport(changeSet.id, { expectedChangeSetHash: changeSet.hash, expectedHead: projection.binding.currentHead, expectedWorkspaceHash: projection.binding.currentWorkspaceHash, expectedLatestReportId: projection.latestReportId, criteria: [...criteria] }, branchId)
      baselineCriteria.current = criteria
      setDirty(false); onDirtyChange(false)
      await load()
      setSaved(true)
    } catch (cause: unknown) {
      if (cause instanceof ApiError && ["STALE_HEAD", "STALE_WORKSPACE", "EVALUATION_REPORT_CAS_MISMATCH"].includes(cause.code)) setError(`서버 기록이 달라졌습니다. 입력은 유지됩니다. ${cause.message}`)
      else setError(cause instanceof Error ? cause.message : "평가 보고서를 저장하지 못했습니다. 입력은 유지됩니다.")
    } finally { setSaving(false) }
  }

  if (loading && !projection) return <section className="evaluation-workspace evaluation-loading" role="status"><LoaderCircle className="spin" /> 평가 근거와 이력을 불러오는 중입니다.</section>
  if (!projection) return <section className="evaluation-workspace"><p className="dialog-error" role="alert">{error ?? "평가 자료를 불러오지 못했습니다."}</p><button className="button quiet" type="button" onClick={() => void load()}><RefreshCw /> 다시 불러오기</button></section>
  return <section className="evaluation-workspace" aria-labelledby="evaluation-title">
    <header><div><p className="overline">EVIDENCE-BOUND HUMAN REVIEW</p><h4 id="evaluation-title">사람의 수동 평가</h4><p>기계 검사는 참고 정보입니다. 아래 의미 기준은 사람이 근거 원문을 인용해 직접 판단하며, 저장해도 제안은 채택되지 않습니다.</p></div><button className="button quiet compact" type="button" disabled={saving} onClick={reload}><RefreshCw /> 서버 상태 다시 불러오기</button></header>
    <BindingNotice projection={projection} />
    <section className="source-ledger" aria-labelledby="source-title"><header><strong id="source-title">평가 기준의 근거 원문</strong><span>{projection.requiredSources.length}</span></header>{projection.requiredSources.map((source) => <article key={source.key} className={source.available ? "available" : "missing"}><span>{source.kind === "feedback" ? "연결된 피드백" : "변경 제안 사유"}</span>{source.available ? <><p>{source.text}</p><code title={source.sourceHash ?? ""}>{source.sourceHash}</code></> : <p><AlertTriangle /> 근거 원문 없음 · {source.warning}</p>}</article>)}</section>
    <section aria-labelledby="mechanical-title"><div className="evaluation-section-title"><div><strong id="mechanical-title">기계 검사 4종</strong><small>사람의 의미 판단과 별개이며 자동 채택 근거가 아닙니다.</small></div></div><MechanicalChecks checks={projection.mechanicalPreview} /></section>
    <section className="criteria-editor" aria-labelledby="criteria-title"><div className="evaluation-section-title"><div><strong id="criteria-title">피드백 기반 평가 기준</strong><small>충족·위반 판단에는 이유와 정확한 이전/제안 인용이 필요합니다.</small></div><button className="button quiet compact" type="button" disabled={saving} onClick={add}><Plus /> 직접 기준 추가</button></div>
      {criteria.map((criterion) => <EvaluationCriterionEditor key={criterion.id} criterion={criterion} entries={changeSet.entries} disabled={saving} actions={{ change: (next) => update(criterion.id, next), remove: () => { setCriteria((current) => current.filter((item) => item.id !== criterion.id)); setSaved(false) }, duplicate: (next) => { setCriteria((current) => [...current, next]); setSaved(false) }, split: (next) => { setCriteria((current) => current.flatMap((item) => item.id === criterion.id ? next : [item])); setSaved(false) } }} />)}
    </section>
    {error ? <p className="dialog-error evaluation-error" role="alert"><AlertTriangle /> {error}</p> : null}{saved ? <p className="evaluation-saved" role="status"><ShieldCheck /> 평가 보고서를 추가했습니다. 제안 채택 상태는 바뀌지 않았습니다.</p> : null}
    <div className="evaluation-save"><span>{dirty ? "저장하지 않은 평가 변경" : "서버 기록과 일치"}</span><button className="button primary" type="button" disabled={saving || !dirty || !projection.binding.actionable} onClick={() => void save()}>{saving ? <LoaderCircle className="spin" /> : <FileCheck2 />} 평가 보고서 저장</button></div>
    <EvaluationHistory history={projection.history} disabled={saving} onEdit={(reportCriteria) => { setCriteria(reportCriteria.map((criterion) => ({ ...criterion, citations: [...criterion.citations], basisRefs: [...criterion.basisRefs] }))); setSaved(false); setError(null); document.getElementById("criteria-title")?.scrollIntoView({ block: "start" }) }} />
  </section>
}

function BindingNotice({ projection }: Readonly<{ projection: EvaluationReportsResponse }>) {
  if (!projection.binding.bindingValid) return <aside className="evaluation-warning danger" role="alert"><AlertTriangle /><div><strong>평가 대상 바인딩이 유효하지 않습니다</strong><p>{projection.binding.staleReasons.join(" · ")} · 이 제안에는 새 평가 보고서를 저장할 수 없습니다.</p></div></aside>
  if (!projection.binding.actionable) return <aside className="evaluation-warning danger" role="alert"><AlertTriangle /><div><strong>현재 제안에는 평가 보고서를 추가할 수 없습니다</strong><p>{projection.binding.staleReasons.join(" · ")}</p></div></aside>
  if (!projection.binding.proposalBaseCurrent) return <aside className="evaluation-warning"><AlertTriangle /><div><strong>이 제안의 기준본이 현재 작업본과 다릅니다</strong><p>{projection.binding.staleReasons.join(" · ")} · 평가 기록은 남길 수 있지만 현재 기준과 다른 제안임을 명확히 확인하세요.</p></div></aside>
  return <aside className="evaluation-warning safe"><ShieldCheck /><div><strong>고정된 제안과 현재 평가 바인딩을 확인했습니다</strong><p>보고서는 head와 작업 공간 hash에 묶여 추가되며, 채택 동작과 분리됩니다.</p></div></aside>
}
