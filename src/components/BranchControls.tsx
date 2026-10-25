import { GitBranch, LoaderCircle, Plus, RefreshCw, X } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import type { SyntheticEvent } from "react"
import type { BranchSummary, Snapshot } from "../types"

type BranchControlsProps = Readonly<{
  branches: readonly BranchSummary[]
  currentBranchId: string
  source: Snapshot | undefined
  busy: boolean
  onSwitch: (id: string) => Promise<void>
  onCreate: (name: string, sourceSnapshotId: string) => Promise<boolean>
  onRefresh: () => Promise<void>
}>

export function BranchControls(props: BranchControlsProps) {
  const [source, setSource] = useState<Snapshot | null>(null)
  const current = props.branches.find((branch) => branch.id === props.currentBranchId)
  const identityReady = Boolean(props.currentBranchId && current)
  const canCreate = identityReady && Boolean(props.source?.canBranch)
  return <section className="branch-controls" aria-labelledby="branch-controls-title">
    <header>
       <div><p className="overline">WORKING BRANCH</p><h3 id="branch-controls-title"><GitBranch /> {current?.name ?? "Branch unavailable"}</h3></div>
       <button className="icon-button" type="button" disabled={props.busy} onClick={() => void props.onRefresh()} aria-label="Reload branch state"><RefreshCw className={props.busy ? "spin" : ""} /></button>
    </header>
    <div className="branch-control-row">
       <label className="field-label">Working branch
        <select value={props.currentBranchId} disabled={props.busy || !identityReady} onChange={(event) => { if (event.target.value !== props.currentBranchId) void props.onSwitch(event.target.value) }}>
           {props.branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name} · Snapshots: {branch.snapshotCount}</option>)}
        </select>
      </label>
       <button className="button primary" type="button" disabled={props.busy || !canCreate} onClick={() => { if (props.source) setSource(props.source) }}><Plus /> Branch from current snapshot</button>
    </div>
     {!identityReady ? <p className="branch-help error">The server did not provide the current branch identifier. Reload state before creating a branch.</p> : <p className="branch-help">A new branch copies canonical scenes and plans only. Saved drafts, feedback, edits, and run history stay on the source branch, and the app does not switch automatically.</p>}
    {source ? <CreateBranchDialog source={source} busy={props.busy} onClose={() => setSource(null)} onCreate={async (name) => { const created = await props.onCreate(name, source.id); if (created) setSource(null); return created }} /> : null}
  </section>
}

export function ForkSnapshotButton({ snapshot, busy, onCreate }: Readonly<{ snapshot: Snapshot; busy: boolean; onCreate: (snapshot: Snapshot) => void }>) {
  if (!snapshot.canBranch) return <span className="branch-unavailable">This legacy snapshot has no recorded narrative context and cannot be branched.</span>
  return <button className="button quiet compact" type="button" disabled={busy} onClick={() => onCreate(snapshot)}><GitBranch /> Branch from here</button>
}

export function CreateBranchDialog({ source, busy, onClose, onCreate }: Readonly<{ source: Snapshot; busy: boolean; onClose: () => void; onCreate: (name: string) => Promise<boolean> }>) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [name, setName] = useState("")
  const [error, setError] = useState<string | null>(null)
  useEffect(() => { dialogRef.current?.showModal() }, [])
  const submit = async (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault()
    const trimmed = name.trim()
    if (!trimmed || busy) return
    setError(null)
    if (!await onCreate(trimmed)) setError("Could not create the branch. The name may already exist or the working copy may have changed. Choose another name or close and reload state.")
  }
  return <dialog ref={dialogRef} className="dialog-scrim" aria-labelledby="branch-create-title" onCancel={(event) => { event.preventDefault(); if (!busy) onClose() }}>
    <section className="dialog branch-dialog">
       <header><div><p className="overline">NEW WORKING LINE</p><h2 id="branch-create-title">Create branch</h2></div><button className="icon-button" type="button" disabled={busy} onClick={onClose} aria-label="Close branch creation"><X /></button></header>
      <form onSubmit={submit}>
        <p className="branch-source"><GitBranch /><span><strong>{source.label}</strong><small>{source.id}</small></span></p>
         <label className="field-label">Branch name<input autoFocus disabled={busy} value={name} onChange={(event) => setName(event.target.value)} maxLength={80} required /></label>
         <p className="branch-help">Copies canonical scenes and plans only. Drafts, feedback, edits, and run history are not copied, and the current branch stays active.</p>
        {error ? <p className="dialog-error" role="alert">{error}</p> : null}
         <footer><button className="button quiet" type="button" disabled={busy} onClick={onClose}>Cancel</button><button className="button primary" type="submit" disabled={busy || !name.trim()}>{busy ? <LoaderCircle className="spin" /> : <Plus />} Create branch</button></footer>
      </form>
    </section>
  </dialog>
}
