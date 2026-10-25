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
      setError(cause instanceof Error ? cause.message : "Could not load evaluation materials.")
    } finally { if (request === sequence.current) setLoading(false) }
  }
  useEffect(() => { void load(); return () => { sequence.current += 1 } }, [changeSet.id, branchId])
  useEffect(() => { const changed = evaluationDraftChanged(baselineCriteria.current, criteria); setDirty(changed); onDirtyChange(changed) }, [criteria, onDirtyChange])

  const update = (id: string, next: EvaluationCriterion) => { setCriteria((current) => current.map((item) => item.id === id ? next : item)); setSaved(false) }
  const add = () => { setCriteria((current) => [...current, { id: crypto.randomUUID(), text: "", formulation: "human_authored", basisRefs: [], verdict: "unknown", rationale: "Not yet evaluated by a human.", citations: [] }]); setSaved(false) }
  const reload = () => { if (onBeforeDiscard()) void load() }
  const save = async () => {
    if (!projection || saving) return
    const invalid = criteria.flatMap(validateCriterion)
    if (criteria.length === 0 || invalid.length > 0) { setError(criteria.length === 0 ? "Add at least one evaluation criterion." : "Resolve the displayed criterion errors first."); return }
    setSaving(true); setError(null); setSaved(false)
    try {
      await createEvaluationReport(changeSet.id, { expectedChangeSetHash: changeSet.hash, expectedHead: projection.binding.currentHead, expectedWorkspaceHash: projection.binding.currentWorkspaceHash, expectedLatestReportId: projection.latestReportId, criteria: [...criteria] }, branchId)
      baselineCriteria.current = criteria
      setDirty(false); onDirtyChange(false)
      await load()
      setSaved(true)
    } catch (cause: unknown) {
      if (cause instanceof ApiError && ["STALE_HEAD", "STALE_WORKSPACE", "EVALUATION_REPORT_CAS_MISMATCH"].includes(cause.code)) setError(`The server record changed. Your input is preserved. ${cause.message}`)
      else setError(cause instanceof Error ? cause.message : "Could not save the evaluation report. Your input is preserved.")
    } finally { setSaving(false) }
  }

  if (loading && !projection) return <section className="evaluation-workspace evaluation-loading" role="status"><LoaderCircle className="spin" /> Loading evaluation evidence and history.</section>
  if (!projection) return <section className="evaluation-workspace"><p className="dialog-error" role="alert">{error ?? "Could not load evaluation materials."}</p><button className="button quiet" type="button" onClick={() => void load()}><RefreshCw /> Reload</button></section>
  return <section className="evaluation-workspace" aria-labelledby="evaluation-title">
    <header><div><p className="overline">EVIDENCE-BOUND HUMAN REVIEW</p><h4 id="evaluation-title">Human evaluation</h4><p>Mechanical checks are reference information. A human judges the semantic criteria below by citing evidence, and saving never adopts the change set.</p></div><button className="button quiet compact" type="button" disabled={saving} onClick={reload}><RefreshCw /> Reload server state</button></header>
    <BindingNotice projection={projection} />
    <section className="source-ledger" aria-labelledby="source-title">
      <header><strong id="source-title">Evidence source text</strong><span>{projection.requiredSources.length}</span></header>
      {projection.requiredSources.map((source) => <article key={source.key} className={source.available ? "available" : "missing"}>
        <span>{source.kind === "feedback" ? "Linked feedback" : "Change set reason"}</span>
        {source.available ? <><p>{source.text}</p><code title={source.sourceHash ?? ""}>{source.sourceHash}</code></> : <p><AlertTriangle /> Evidence source unavailable · {source.warning}</p>}
      </article>)}
    </section>
    <section aria-labelledby="mechanical-title"><div className="evaluation-section-title"><div><strong id="mechanical-title">Four mechanical checks</strong><small>Separate from human semantic judgment and never grounds for automatic adoption.</small></div></div><MechanicalChecks checks={projection.mechanicalPreview} /></section>
    <section className="criteria-editor" aria-labelledby="criteria-title"><div className="evaluation-section-title"><div><strong id="criteria-title">Feedback-based evaluation criteria</strong><small>Fulfilled or violated judgments require a rationale and exact before/proposal citations.</small></div><button className="button quiet compact" type="button" disabled={saving} onClick={add}><Plus /> Add criterion</button></div>
      {criteria.map((criterion) => <EvaluationCriterionEditor
        key={criterion.id}
        criterion={criterion}
        entries={changeSet.entries}
        disabled={saving}
        actions={{
          change: (next) => update(criterion.id, next),
          remove: () => { setCriteria((current) => current.filter((item) => item.id !== criterion.id)); setSaved(false) },
          duplicate: (next) => { setCriteria((current) => [...current, next]); setSaved(false) },
          split: (next) => { setCriteria((current) => current.flatMap((item) => item.id === criterion.id ? next : [item])); setSaved(false) },
        }}
      />)}
    </section>
    {error ? <p className="dialog-error evaluation-error" role="alert"><AlertTriangle /> {error}</p> : null}{saved ? <p className="evaluation-saved" role="status"><ShieldCheck /> Evaluation report added. The adoption status did not change.</p> : null}
    <div className="evaluation-save"><span>{dirty ? "Unsaved evaluation changes" : "Matches server record"}</span><button className="button primary" type="button" disabled={saving || !dirty || !projection.binding.actionable} onClick={() => void save()}>{saving ? <LoaderCircle className="spin" /> : <FileCheck2 />} Save evaluation report</button></div>
    <EvaluationHistory history={projection.history} disabled={saving} onEdit={(reportCriteria) => { setCriteria(reportCriteria.map((criterion) => ({ ...criterion, citations: [...criterion.citations], basisRefs: [...criterion.basisRefs] }))); setSaved(false); setError(null); document.getElementById("criteria-title")?.scrollIntoView({ block: "start" }) }} />
  </section>
}

function BindingNotice({ projection }: Readonly<{ projection: EvaluationReportsResponse }>) {
  if (!projection.binding.bindingValid) return <aside className="evaluation-warning danger" role="alert"><AlertTriangle /><div><strong>The evaluation target binding is invalid</strong><p>{projection.binding.staleReasons.join(" · ")} · A new evaluation report cannot be saved for this change set.</p></div></aside>
  if (!projection.binding.actionable) return <aside className="evaluation-warning danger" role="alert"><AlertTriangle /><div><strong>An evaluation report cannot be added to this change set</strong><p>{projection.binding.staleReasons.join(" · ")}</p></div></aside>
  if (!projection.binding.proposalBaseCurrent) return <aside className="evaluation-warning"><AlertTriangle /><div><strong>This change set's base differs from the current working copy</strong><p>{projection.binding.staleReasons.join(" · ")} · You may record an evaluation, but confirm that the change set differs from the current criteria.</p></div></aside>
  return <aside className="evaluation-warning safe"><ShieldCheck /><div><strong>Frozen change set and current evaluation binding verified</strong><p>The report is appended against the head and workspace hash, separately from adoption.</p></div></aside>
}
