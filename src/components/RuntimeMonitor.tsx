import { Bot, Box, Braces, Cpu, RefreshCw, ShieldCheck } from "lucide-react"
import { useEffect, useState } from "react"
import type { RuntimeInfo, SafeRunSummary } from "../../packages/execution/contracts.ts"
import { getRuntimeInfo, getRuntimeRuns } from "../api"
import type { Plan, Scene } from "../types"
import { RuntimeComposer } from "./RuntimeComposer"
import { RuntimeRunDetail } from "./RuntimeRunDetail"

type Props = Readonly<{
  branchId: string
  baseSnapshotId: string
  baseWorkspaceHash: string
  scenes: readonly Scene[]
  plans: readonly Plan[]
  onDirtyChange: (dirty: boolean) => void
  onOpenResult: (resultRef: string) => void
}>

const stateLabels: Readonly<Record<string, string>> = { queued: "Queued", running: "Running", paused: "Paused", awaiting_decision: "Awaiting review", completed: "Completed", cancelled: "Cancelled", failed: "Failed" }

export function RuntimeMonitor(props: Props) {
  const [runtime, setRuntime] = useState<RuntimeInfo | null>(null)
  const [runs, setRuns] = useState<readonly SafeRunSummary[]>([])
  const [selectedId, setSelectedId] = useState("")
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const load = async () => {
    setLoading(true); setError(null)
    try {
      const [info, history] = await Promise.all([getRuntimeInfo(), getRuntimeRuns(props.branchId)])
      setRuntime(info); setRuns(history); setSelectedId((current) => history.some((run) => run.id === current) ? current : (history[0]?.id ?? ""))
    } catch (cause: unknown) { setError(cause instanceof Error ? cause.message : "Could not load runtime history.") }
    finally { setLoading(false) }
  }
  useEffect(() => { void load() }, [props.branchId])
  const updateRun = (run: SafeRunSummary) => setRuns((current) => [run, ...current.filter((item) => item.id !== run.id)].slice(0, 50))
  const selected = runs.find((run) => run.id === selectedId)
  return <main className="secondary-view runtime-view" id="main-content">
    <header className="view-header"><div><p className="overline">BOUNDED AGENT RUNTIME</p><h2>Agent runs</h2><p className="view-description">Create repair proposals from read-only context, inspect the public run history, then let a human decide whether to adopt.</p></div><button className="icon-button" type="button" disabled={loading} onClick={() => void load()} aria-label="Reload runtime and run history"><RefreshCw className={loading ? "spin" : ""} /></button></header>
    {error ? <div className="runtime-load-error" role="alert"><p>{error}</p><button className="button quiet" type="button" onClick={() => void load()}>Reconnect</button></div> : null}
    {runtime ? <>
      <RuntimeIdentity runtime={runtime} />
      <RuntimeComposer runtime={runtime} branchId={props.branchId} baseSnapshotId={props.baseSnapshotId} baseWorkspaceHash={props.baseWorkspaceHash} scenes={props.scenes} plans={props.plans} onDirtyChange={props.onDirtyChange} onCreated={(run) => { updateRun(run); setSelectedId(run.id) }} />
      <div className="runtime-ledger-layout">
        <section className="runtime-history" aria-labelledby="runtime-history-title">
          <header><div><p className="overline">LATEST 50</p><h3 id="runtime-history-title">Run history</h3></div><span>{runs.length.toLocaleString("en-US")}</span></header>
          {runs.length === 0 ? <div className="empty-review"><ShieldCheck /><strong>No agent runs yet</strong><p>Choose a scope and budget to start the first repair proposal.</p></div> :
            <nav aria-label="Recent agent runs">{runs.map((run) =>
              <button type="button" key={run.id} className={run.id === selectedId ? "active" : ""} onClick={() => setSelectedId(run.id)}>
                <span className={`runtime-state ${run.state}`}>{stateLabels[run.state] ?? run.state}</span><strong>{new Date(run.createdAt).toLocaleString("en-US")}</strong>
                <small>Calls {run.usage.reservedModelCalls} · Output {run.usage.known ? run.usage.actualOutputTokens.toLocaleString("en-US") : "Unknown"}</small>
              </button>)}</nav>}
        </section>
        {selected ? <RuntimeRunDetail key={`${props.branchId}:${selected.id}`} run={selected} branchId={props.branchId} onUpdated={updateRun} onOpenResult={props.onOpenResult} /> : <section className="runtime-detail runtime-detail-empty"><Bot /><h3>Select a run</h3><p>Inspect public text, model and tool steps, and usage here.</p></section>}
      </div>
    </> : loading ? <div className="preview-state" role="status">Loading runtime information.</div> : null}
  </main>
}

function RuntimeIdentity({ runtime }: Readonly<{ runtime: RuntimeInfo }>) {
  return <section className="runtime-identity" aria-labelledby="runtime-identity-title">
    <div><p className="overline">CURRENT SERVER CONFIG</p><h3 id="runtime-identity-title"><Cpu /> {runtime.model.label}</h3><p>This is the current server configuration, not provenance for historical runs.</p></div>
    <dl><div><dt><Box /> Runtime</dt><dd>{runtime.runtime} {runtime.partVersion}</dd></div>
      <div><dt><Bot /> Mode</dt><dd>{runtime.nonAI ? "Local example (not AI)" : "OpenAI-compatible connection"}</dd></div>
      <div><dt><Braces /> Read tools</dt><dd><details><summary>{runtime.readOnlyToolIds.length} allowed</summary>{runtime.readOnlyToolIds.map((id) => <code key={id}>{id}</code>)}</details></dd></div>
    </dl>
  </section>
}
