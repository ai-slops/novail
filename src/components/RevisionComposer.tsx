import { Bot, FilePenLine, LoaderCircle, X } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import type { SyntheticEvent } from "react"
import { createChangeSet, getRevisionContext, mutate, mutateJson, waitForRun } from "../api"
import { createdIdSchema } from "../schema"
import { repairRunSchema } from "../../packages/revision/contracts.ts"
import type { ChangeInput, RevisionContext } from "../../packages/revision/contracts.ts"

type ComposerProps = Readonly<{
  mode: "manual" | "repair"
  branchId: string
  initialSceneId?: string
  initialInstruction?: string
  feedbackIds?: readonly string[]
  onClose: () => void
  onCreated: (id?: string) => Promise<void>
}>

export function RevisionComposer(props: ComposerProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [context, setContext] = useState<RevisionContext | null>(null)
  const [sceneIds, setSceneIds] = useState<readonly string[]>(props.initialSceneId ? [props.initialSceneId] : [])
  const [planIds, setPlanIds] = useState<readonly string[]>([])
  const [instruction, setInstruction] = useState(props.initialInstruction ?? "")
  const [values, setValues] = useState<Readonly<Record<string, string>>>({})
  const [deletions, setDeletions] = useState<readonly string[]>([])
  const [atomic, setAtomic] = useState(false)
  const [busy, setBusy] = useState(false)
  const [activeRunId, setActiveRunId] = useState<string | null>(null)
  const [cancelling, setCancelling] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const dirty = Boolean(instruction || sceneIds.length || planIds.length || Object.keys(values).length)
  useEffect(() => { dialogRef.current?.showModal(); void getRevisionContext(props.branchId).then((value) => {
    setContext(value)
    setSceneIds((ids) => ids.filter((id) => value.workspace.scenes.some((scene) => scene.id === id)))
    if (props.initialSceneId && !value.workspace.scenes.some((scene) => scene.id === props.initialSceneId)) setError("피드백의 원래 장면이 현재 기준본에 없습니다. 수정 대상을 다시 선택하세요.")
  }).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "수정 맥락을 불러오지 못했습니다.")) }, [])
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (dirty) event.preventDefault() }
    window.addEventListener("beforeunload", warn)
    return () => window.removeEventListener("beforeunload", warn)
  }, [dirty])
  const close = () => { if (!busy && (!dirty || window.confirm("작성 중인 수정 제안을 버릴까요?"))) props.onClose() }
  const cancelRun = async () => {
    if (!activeRunId || cancelling) return
    setCancelling(true)
    try { await mutate(`api/runs/${activeRunId}/cancel`, {}, props.branchId) }
    catch (cause: unknown) { setError(cause instanceof Error ? cause.message : "작업을 취소하지 못했습니다.") }
    finally { setCancelling(false) }
  }
  const toggle = (values: readonly string[], id: string): readonly string[] => values.includes(id) ? values.filter((value) => value !== id) : [...values, id]
  const submit = async (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (busy || !context || !instruction.trim()) return
    setBusy(true); setError(null)
    try {
      if (props.mode === "repair") {
        const input = repairRunSchema.parse({ baseSnapshotId: context.baseSnapshotId, baseWorkspaceHash: context.workspaceHash, instruction: instruction.trim(), sceneIds, planIds, feedbackIds: props.feedbackIds ?? [] })
        const result = createdIdSchema.parse(await mutateJson<unknown>("api/repair-runs", input, props.branchId))
        setActiveRunId(result.id)
        await props.onCreated(await waitForRun(result.id, props.branchId))
      } else {
        const changes: ChangeInput[] = []
        for (const id of sceneIds) {
          const scene = context.workspace.scenes.find((item) => item.id === id)
          if (scene) changes.push({ kind: "scene", artifactId: id, after: deletions.includes(id) ? null : { ...scene, text: values[id] ?? scene.text } })
        }
        for (const id of planIds) {
          const plan = context.workspace.plans.find((item) => item.id === id)
          if (plan) changes.push({ kind: "plan", artifactId: id, after: deletions.includes(id) ? null : { ...plan, description: values[id] ?? plan.description } })
        }
        const created = await createChangeSet({ baseSnapshotId: context.baseSnapshotId, baseWorkspaceHash: context.workspaceHash, reason: instruction.trim(), changes, feedbackIds: props.feedbackIds ?? [], atomic }, props.branchId)
        await props.onCreated(created.id)
      }
      props.onClose()
    } catch (cause: unknown) { setError(cause instanceof Error ? cause.message : "수정 제안을 만들지 못했습니다.") } finally { setBusy(false); setActiveRunId(null) }
  }
  return <dialog ref={dialogRef} className="dialog-scrim" onCancel={(event) => { event.preventDefault(); close() }} aria-labelledby="composer-title">
    <section className="dialog revision-dialog">
      <header><div><p className="overline">SCOPED REVISION</p><h2 id="composer-title">{props.mode === "repair" ? "AI 수정 제안" : "수동 변경 제안"}</h2></div><button className="icon-button" type="button" disabled={busy} onClick={close} aria-label="수정 제안 닫기"><X /></button></header>
      {context ? <form onSubmit={submit}>
        <fieldset className="composer-fields" disabled={busy} aria-label="수정 제안 내용">
          <p className="mechanical-note">{props.mode === "repair" ? <Bot /> : <FilePenLine />} 검토할 범위를 직접 고르세요. 모델은 선택한 원고와 기획의 텍스트만 제안하며 자동 반영하지 않습니다.</p>
          <label className="field-label">수정 의도<textarea value={instruction} onChange={(event) => setInstruction(event.target.value)} required /></label>
          <ArtifactChoices context={context} sceneIds={sceneIds} planIds={planIds} values={values} deletions={deletions} onScene={(id) => setSceneIds(toggle(sceneIds, id))} onPlan={(id) => setPlanIds(toggle(planIds, id))} onValue={(id, value) => setValues((current) => ({ ...current, [id]: value }))} onDelete={(id) => setDeletions(toggle(deletions, id))} manual={props.mode === "manual"} />
          {props.mode === "manual" ? <label className="approval-check"><input type="checkbox" checked={atomic} onChange={(event) => setAtomic(event.target.checked)} /><span><strong>원자적 묶음</strong> 선택한 모든 변경을 함께 채택하거나 모두 보류합니다.</span></label> : null}
        </fieldset>
        {activeRunId ? <p className="mechanical-note" role="status">개정 작업을 실행 중입니다. 취소해도 이미 시작된 외부 호출 비용은 발생할 수 있습니다.</p> : null}
        {error ? <p className="dialog-error" role="alert">{error}</p> : null}
        <footer>{activeRunId ? <button className="button quiet" type="button" disabled={cancelling} onClick={() => void cancelRun()}>실행 취소</button> : <button className="button quiet" type="button" disabled={busy} onClick={close}>취소</button>}<button className="button primary" type="submit" disabled={busy || !instruction.trim() || sceneIds.length + planIds.length === 0}>{busy ? <LoaderCircle className="spin" /> : null} 제안 만들기</button></footer>
      </form> : <div className="preview-state" role={error ? "alert" : "status"}>{error ?? <><LoaderCircle className="spin" /> 수정 맥락을 불러오는 중입니다.</>}</div>}
    </section>
  </dialog>
}

type ChoiceProps = Readonly<{ context: RevisionContext; sceneIds: readonly string[]; planIds: readonly string[]; values: Readonly<Record<string, string>>; deletions: readonly string[]; manual: boolean; onScene: (id: string) => void; onPlan: (id: string) => void; onValue: (id: string, value: string) => void; onDelete: (id: string) => void }>
function ArtifactChoices(props: ChoiceProps) {
  const scenes = props.context.workspace.scenes.toSorted((left, right) => props.context.workspace.layout.indexOf(left.id) - props.context.workspace.layout.indexOf(right.id))
  return <div className="artifact-choices"><fieldset><legend>원고 장면</legend>{scenes.map((scene) => <div className="artifact-choice" key={scene.id}><label><input type="checkbox" checked={props.sceneIds.includes(scene.id)} onChange={() => props.onScene(scene.id)} /> <span>{scene.chapter}장 · {scene.title}</span></label>{props.manual && props.sceneIds.includes(scene.id) ? <><textarea aria-label={`${scene.title} 수정 본문`} value={props.values[scene.id] ?? scene.text} onChange={(event) => props.onValue(scene.id, event.target.value)} /><label className="danger-check"><input type="checkbox" checked={props.deletions.includes(scene.id)} onChange={() => props.onDelete(scene.id)} /> 이 장면 삭제 확인</label></> : null}</div>)}</fieldset><fieldset><legend>기획 항목</legend>{props.context.workspace.plans.map((plan) => <div className="artifact-choice" key={plan.id}><label><input type="checkbox" checked={props.planIds.includes(plan.id)} onChange={() => props.onPlan(plan.id)} /> <span>{plan.kind} · {plan.title}</span></label>{props.manual && props.planIds.includes(plan.id) ? <><textarea aria-label={`${plan.title} 수정 설명`} value={props.values[plan.id] ?? plan.description} onChange={(event) => props.onValue(plan.id, event.target.value)} /><label className="danger-check"><input type="checkbox" checked={props.deletions.includes(plan.id)} onChange={() => props.onDelete(plan.id)} /> 이 기획 삭제 확인</label></> : null}</div>)}</fieldset></div>
}
