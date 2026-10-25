import { LoaderCircle, Play, SlidersHorizontal } from "lucide-react"
import { useEffect, useState } from "react"
import type { SyntheticEvent } from "react"
import type { ExecutionBudget, RuntimeInfo, SafeRunSummary } from "../../packages/execution/contracts.ts"
import { createRepairRun } from "../api"
import type { Plan, Scene } from "../types"
import { ModelSelector } from "./ModelSelector"

const budgetFields = [
  { key: "maxModelCalls", label: "Model calls", unit: "calls" },
  { key: "maxToolDispatches", label: "Tool dispatches", unit: "calls" },
  { key: "maxKnownTokens", label: "Known tokens", unit: "tokens" },
  { key: "maxOutputTokens", label: "Total output", unit: "tokens" },
  { key: "maxOutputTokensPerInvocation", label: "Output per call", unit: "tokens" },
  { key: "deadlineSeconds", label: "Deadline", unit: "seconds" },
] as const

type Props = Readonly<{
  runtime: RuntimeInfo
  branchId: string
  baseSnapshotId: string
  baseWorkspaceHash: string
  scenes: readonly Scene[]
  plans: readonly Plan[]
  onDirtyChange: (dirty: boolean) => void
  onCreated: (run: SafeRunSummary) => void
}>

export function RuntimeComposer(props: Props) {
  const [instruction, setInstruction] = useState("")
  const [sceneIds, setSceneIds] = useState<readonly string[]>([])
  const [planIds, setPlanIds] = useState<readonly string[]>([])
  const [budget, setBudget] = useState<ExecutionBudget>(props.runtime.publicBudget.defaults)
  const [model, setModel] = useState("")
  const [modelDirty, setModelDirty] = useState(false)
  const [modelReady, setModelReady] = useState(props.runtime.nonAI)
  const [launching, setLaunching] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const dirty = instruction.length > 0 || sceneIds.length > 0 || planIds.length > 0 || modelDirty
  useEffect(() => setBudget(props.runtime.publicBudget.defaults), [props.runtime])
  useEffect(() => props.onDirtyChange(dirty), [dirty, props.onDirtyChange])
  const toggle = (values: readonly string[], id: string): readonly string[] => values.includes(id) ? values.filter((value) => value !== id) : [...values, id]
  const budgetValid = budget.maxKnownTokens >= budget.maxOutputTokens && budget.maxOutputTokensPerInvocation <= budget.maxOutputTokens
  const canLaunch = instruction.trim().length > 0 && sceneIds.length + planIds.length > 0 && budgetValid && modelReady && !launching
  const submit = async (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!canLaunch) return
    setLaunching(true)
    setError(null)
    try {
      const run = await createRepairRun({
        baseSnapshotId: props.baseSnapshotId,
        baseWorkspaceHash: props.baseWorkspaceHash,
        instruction: instruction.trim(),
        sceneIds,
        planIds,
        feedbackIds: [],
        budget,
        ...(model ? { model } : {}),
      }, props.branchId)
      props.onCreated(run)
      setInstruction("")
      setSceneIds([])
      setPlanIds([])
      setModelDirty(false)
      props.onDirtyChange(false)
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : "Could not start the run.")
    } finally {
      setLaunching(false)
    }
  }
  return <section className="runtime-composer" aria-labelledby="runtime-composer-title">
    <header><div><p className="overline">SCOPED REPAIR</p><h3 id="runtime-composer-title">Run with a defined scope</h3></div><SlidersHorizontal /></header>
    <form onSubmit={submit}>
      <ModelSelector value={model} disabled={launching} localDemo={props.runtime.nonAI} onChange={(value, userInitiated) => { setModel(value); if (userInitiated) setModelDirty(true) }} onReadyChange={setModelReady} />
      <label className="field-label">Revision intent<textarea value={instruction} onChange={(event) => setInstruction(event.target.value)} placeholder="Describe the issue to review and the constraints to preserve." required /></label>
      <div className="runtime-scope-grid">
        <fieldset><legend>Manuscript scenes</legend>{props.scenes.map((scene) => <label key={scene.id}><input type="checkbox" checked={sceneIds.includes(scene.id)} onChange={() => setSceneIds(toggle(sceneIds, scene.id))} /><span>{scene.chapter} · {scene.title}</span></label>)}</fieldset>
        <fieldset><legend>Plan items</legend>{props.plans.map((plan) => <label key={plan.id}><input type="checkbox" checked={planIds.includes(plan.id)} onChange={() => setPlanIds(toggle(planIds, plan.id))} /><span>{plan.kind} · {plan.title}</span></label>)}</fieldset>
      </div>
      <fieldset className="budget-fieldset"><legend>Run budget</legend><div className="budget-grid">{budgetFields.map((field) => {
        const limit = props.runtime.publicBudget.limits[field.key]
        return <label key={field.key}><span>{field.label}<small>{field.unit}</small></span><input type="number" min={limit?.min} max={limit?.max} value={budget[field.key]} onChange={(event) => {
          const value = event.currentTarget.valueAsNumber
          setBudget((current) => ({ ...current, [field.key]: value }))
        }} /></label>
      })}</div><p>Total output must not exceed known tokens, and output per call must not exceed total output.</p></fieldset>
      {!budgetValid ? <p className="dialog-error" role="alert">Check the output budget constraints.</p> : null}
      {error ? <p className="dialog-error" role="alert">{error}</p> : null}
      <footer><p>Only the selected read-only context is sent. The result remains a proposal awaiting review.</p><button className="button primary" type="submit" disabled={!canLaunch}>{launching ? <LoaderCircle className="spin" /> : <Play />} {launching ? "Preparing run" : "Run repair"}</button></footer>
    </form>
  </section>
}
