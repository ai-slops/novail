import { Bot, FilePenLine, LoaderCircle, X } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import type { SyntheticEvent } from "react"
import { createChangeSet, getRevisionContext, mutate, mutateJson, waitForRun } from "../api"
import { createdIdSchema } from "../schema"
import { repairRunSchema } from "../../packages/revision/contracts.ts"
import type { ChangeInput, RevisionContext } from "../../packages/revision/contracts.ts"
import { ModelSelector } from "./ModelSelector"

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
  const [model, setModel] = useState("")
  const [modelDirty, setModelDirty] = useState(false)
  const [modelReady, setModelReady] = useState(props.mode === "manual")
  const dirty = Boolean(instruction || sceneIds.length || planIds.length || Object.keys(values).length || modelDirty)
  useEffect(() => { dialogRef.current?.showModal(); void getRevisionContext(props.branchId).then((value) => {
    setContext(value)
    setSceneIds((ids) => ids.filter((id) => value.workspace.scenes.some((scene) => scene.id === id)))
    if (props.initialSceneId && !value.workspace.scenes.some((scene) => scene.id === props.initialSceneId)) setError("The feedback's original scene is not in the current canonical text. Select revision targets again.")
  }).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "Could not load revision context.")) }, [])
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (dirty) event.preventDefault() }
    window.addEventListener("beforeunload", warn)
    return () => window.removeEventListener("beforeunload", warn)
  }, [dirty])
  const close = () => { if (!busy && (!dirty || window.confirm("Discard the revision proposal in progress?"))) props.onClose() }
  const cancelRun = async () => {
    if (!activeRunId || cancelling) return
    setCancelling(true)
    try { await mutate(`api/runs/${activeRunId}/cancel`, {}, props.branchId) }
    catch (cause: unknown) { setError(cause instanceof Error ? cause.message : "Could not cancel the run.") }
    finally { setCancelling(false) }
  }
  const toggle = (values: readonly string[], id: string): readonly string[] => values.includes(id) ? values.filter((value) => value !== id) : [...values, id]
  const submit = async (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (busy || !context || !instruction.trim() || (props.mode === "repair" && !modelReady)) return
    setBusy(true); setError(null)
    let launchedRunId: string | null = null
    try {
      if (props.mode === "repair") {
        const input = repairRunSchema.parse({ baseSnapshotId: context.baseSnapshotId, baseWorkspaceHash: context.workspaceHash, instruction: instruction.trim(), sceneIds, planIds, feedbackIds: props.feedbackIds ?? [], ...(model ? { model } : {}) })
        const result = createdIdSchema.parse(await mutateJson<unknown>("api/repair-runs", input, props.branchId))
        launchedRunId = result.id
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
    } catch (cause: unknown) {
      const message = cause instanceof Error ? cause.message : "Could not create the revision proposal."
      setError(launchedRunId === null ? message : `${message} Check the logs in Agent runs. Run ID: ${launchedRunId}`)
    } finally { setBusy(false); setActiveRunId(null) }
  }
  return <dialog ref={dialogRef} className="dialog-scrim" onCancel={(event) => { event.preventDefault(); close() }} aria-labelledby="composer-title">
    <section className="dialog revision-dialog">
      <header><div><p className="overline">SCOPED REVISION</p><h2 id="composer-title">{props.mode === "repair" ? "AI repair proposal" : "Manual change set"}</h2></div><button className="icon-button" type="button" disabled={busy} onClick={close} aria-label="Close revision proposal"><X /></button></header>
      {context ? <form onSubmit={submit}>
        <fieldset className="composer-fields" disabled={busy} aria-label="Revision proposal contents">
          <p className="mechanical-note">{props.mode === "repair" ? <Bot /> : <FilePenLine />} Choose the review scope yourself. The model proposes text only for selected manuscripts and plans and never applies it automatically.</p>
          {props.mode === "repair" ? <ModelSelector value={model} disabled={busy} onChange={(value, userInitiated) => { setModel(value); if (userInitiated) setModelDirty(true) }} onReadyChange={setModelReady} /> : null}
          <label className="field-label">Revision intent<textarea value={instruction} onChange={(event) => setInstruction(event.target.value)} required /></label>
          <ArtifactChoices context={context} sceneIds={sceneIds} planIds={planIds} values={values} deletions={deletions} onScene={(id) => setSceneIds(toggle(sceneIds, id))} onPlan={(id) => setPlanIds(toggle(planIds, id))} onValue={(id, value) => setValues((current) => ({ ...current, [id]: value }))} onDelete={(id) => setDeletions(toggle(deletions, id))} manual={props.mode === "manual"} />
          {props.mode === "manual" ? <label className="approval-check"><input type="checkbox" checked={atomic} onChange={(event) => setAtomic(event.target.checked)} /><span><strong>Atomic bundle</strong> Adopt all selected changes together or defer them all.</span></label> : null}
        </fieldset>
        {activeRunId ? <p className="mechanical-note" role="status">The revision run is in progress. Cancelling may not prevent charges for external calls already started.</p> : null}
        {error ? <p className="dialog-error" role="alert">{error}</p> : null}
        <footer>
          {activeRunId
            ? <button className="button quiet" type="button" disabled={cancelling} onClick={() => void cancelRun()}>Cancel run</button>
            : <button className="button quiet" type="button" disabled={busy} onClick={close}>Cancel</button>}
          <button className="button primary" type="submit" disabled={busy || !instruction.trim() || sceneIds.length + planIds.length === 0 || (props.mode === "repair" && !modelReady)}>
            {busy ? <LoaderCircle className="spin" /> : null} Create proposal
          </button>
        </footer>
      </form> : <div className="preview-state" role={error ? "alert" : "status"}>{error ?? <><LoaderCircle className="spin" /> Loading revision context.</>}</div>}
    </section>
  </dialog>
}

type ChoiceProps = Readonly<{ context: RevisionContext; sceneIds: readonly string[]; planIds: readonly string[]; values: Readonly<Record<string, string>>; deletions: readonly string[]; manual: boolean; onScene: (id: string) => void; onPlan: (id: string) => void; onValue: (id: string, value: string) => void; onDelete: (id: string) => void }>
function ArtifactChoices(props: ChoiceProps) {
  const scenes = props.context.workspace.scenes.toSorted((left, right) => props.context.workspace.layout.indexOf(left.id) - props.context.workspace.layout.indexOf(right.id))
  return <div className="artifact-choices">
    <fieldset>
      <legend>Manuscript scenes</legend>
      {scenes.map((scene) => <div className="artifact-choice" key={scene.id}>
        <label>
          <input type="checkbox" checked={props.sceneIds.includes(scene.id)} onChange={() => props.onScene(scene.id)} />
          <span>{scene.chapter} · {scene.title}</span>
        </label>
        {props.manual && props.sceneIds.includes(scene.id) ? <>
          <textarea aria-label={`${scene.title} revised body`} value={props.values[scene.id] ?? scene.text} onChange={(event) => props.onValue(scene.id, event.target.value)} />
          <label className="danger-check"><input type="checkbox" checked={props.deletions.includes(scene.id)} onChange={() => props.onDelete(scene.id)} /> Confirm scene deletion</label>
        </> : null}
      </div>)}
    </fieldset>
    <fieldset>
      <legend>Plan items</legend>
      {props.context.workspace.plans.map((plan) => <div className="artifact-choice" key={plan.id}>
        <label>
          <input type="checkbox" checked={props.planIds.includes(plan.id)} onChange={() => props.onPlan(plan.id)} />
          <span>{plan.kind} · {plan.title}</span>
        </label>
        {props.manual && props.planIds.includes(plan.id) ? <>
          <textarea aria-label={`${plan.title} revised description`} value={props.values[plan.id] ?? plan.description} onChange={(event) => props.onValue(plan.id, event.target.value)} />
          <label className="danger-check"><input type="checkbox" checked={props.deletions.includes(plan.id)} onChange={() => props.onDelete(plan.id)} /> Confirm plan deletion</label>
        </> : null}
      </div>)}
    </fieldset>
  </div>
}
