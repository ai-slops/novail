import { LoaderCircle, Play, SlidersHorizontal } from "lucide-react"
import { useEffect, useState } from "react"
import type { SyntheticEvent } from "react"
import type { ExecutionBudget, RuntimeInfo, SafeRunSummary } from "../../packages/execution/contracts.ts"
import { createRepairRun } from "../api"
import type { Plan, Scene } from "../types"
import { ModelSelector } from "./ModelSelector"

const budgetFields = [
  { key: "maxModelCalls", label: "모델 호출", unit: "회" },
  { key: "maxToolDispatches", label: "도구 실행", unit: "회" },
  { key: "maxKnownTokens", label: "알려진 토큰", unit: "토큰" },
  { key: "maxOutputTokens", label: "전체 출력", unit: "토큰" },
  { key: "maxOutputTokensPerInvocation", label: "호출당 출력", unit: "토큰" },
  { key: "deadlineSeconds", label: "제한 시간", unit: "초" },
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
      setError(cause instanceof Error ? cause.message : "실행을 시작하지 못했습니다.")
    } finally {
      setLaunching(false)
    }
  }
  return <section className="runtime-composer" aria-labelledby="runtime-composer-title">
    <header><div><p className="overline">SCOPED REPAIR</p><h3 id="runtime-composer-title">범위를 정해 실행하기</h3></div><SlidersHorizontal /></header>
    <form onSubmit={submit}>
      <ModelSelector value={model} disabled={launching} localDemo={props.runtime.nonAI} onChange={(value, userInitiated) => { setModel(value); if (userInitiated) setModelDirty(true) }} onReadyChange={setModelReady} />
      <label className="field-label">수정 의도<textarea value={instruction} onChange={(event) => setInstruction(event.target.value)} placeholder="검토할 문제와 유지해야 할 조건을 구체적으로 적으세요." required /></label>
      <div className="runtime-scope-grid">
        <fieldset><legend>원고 장면</legend>{props.scenes.map((scene) => <label key={scene.id}><input type="checkbox" checked={sceneIds.includes(scene.id)} onChange={() => setSceneIds(toggle(sceneIds, scene.id))} /><span>{scene.chapter} · {scene.title}</span></label>)}</fieldset>
        <fieldset><legend>기획 항목</legend>{props.plans.map((plan) => <label key={plan.id}><input type="checkbox" checked={planIds.includes(plan.id)} onChange={() => setPlanIds(toggle(planIds, plan.id))} /><span>{plan.kind} · {plan.title}</span></label>)}</fieldset>
      </div>
      <fieldset className="budget-fieldset"><legend>실행 예산</legend><div className="budget-grid">{budgetFields.map((field) => {
        const limit = props.runtime.publicBudget.limits[field.key]
        return <label key={field.key}><span>{field.label}<small>{field.unit}</small></span><input type="number" min={limit?.min} max={limit?.max} value={budget[field.key]} onChange={(event) => {
          const value = event.currentTarget.valueAsNumber
          setBudget((current) => ({ ...current, [field.key]: value }))
        }} /></label>
      })}</div><p>전체 출력은 알려진 토큰 이하여야 하며, 호출당 출력은 전체 출력 이하여야 합니다.</p></fieldset>
      {!budgetValid ? <p className="dialog-error" role="alert">출력 예산의 포함 관계를 확인하세요.</p> : null}
      {error ? <p className="dialog-error" role="alert">{error}</p> : null}
      <footer><p>선택한 읽기 전용 맥락만 전달되며 결과는 검토 대기 제안으로 남습니다.</p><button className="button primary" type="submit" disabled={!canLaunch}>{launching ? <LoaderCircle className="spin" /> : <Play />} {launching ? "실행 준비 중" : "수리 실행"}</button></footer>
    </form>
  </section>
}
