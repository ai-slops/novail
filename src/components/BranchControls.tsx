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
      <div><p className="overline">WORKING BRANCH</p><h3 id="branch-controls-title"><GitBranch /> {current?.name ?? "분기 정보 없음"}</h3></div>
      <button className="icon-button" type="button" disabled={props.busy} onClick={() => void props.onRefresh()} aria-label="분기 상태 다시 불러오기"><RefreshCw className={props.busy ? "spin" : ""} /></button>
    </header>
    <div className="branch-control-row">
      <label className="field-label">작업 분기
        <select value={props.currentBranchId} disabled={props.busy || !identityReady} onChange={(event) => { if (event.target.value !== props.currentBranchId) void props.onSwitch(event.target.value) }}>
          {props.branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name} · 스냅샷 {branch.snapshotCount}</option>)}
        </select>
      </label>
      <button className="button primary" type="button" disabled={props.busy || !canCreate} onClick={() => { if (props.source) setSource(props.source) }}><Plus /> 현재 스냅샷에서 분기</button>
    </div>
    {!identityReady ? <p className="branch-help error">서버에서 현재 분기 식별자를 받지 못했습니다. 상태를 다시 불러온 뒤 분기를 만드세요.</p> : <p className="branch-help">새 분기는 정식 장면과 기획만 복사합니다. 저장된 초안, 피드백, 편집안, 실행 기록은 원래 분기에 남고 새 분기로 자동 전환되지 않습니다.</p>}
    {source ? <CreateBranchDialog source={source} busy={props.busy} onClose={() => setSource(null)} onCreate={async (name) => { const created = await props.onCreate(name, source.id); if (created) setSource(null); return created }} /> : null}
  </section>
}

export function ForkSnapshotButton({ snapshot, busy, onCreate }: Readonly<{ snapshot: Snapshot; busy: boolean; onCreate: (snapshot: Snapshot) => void }>) {
  if (!snapshot.canBranch) return <span className="branch-unavailable">기록된 서사 맥락이 없는 이전 스냅샷이라 분기할 수 없습니다.</span>
  return <button className="button quiet compact" type="button" disabled={busy} onClick={() => onCreate(snapshot)}><GitBranch /> 여기서 분기</button>
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
    if (!await onCreate(trimmed)) setError("분기를 만들지 못했습니다. 이름이 중복되었거나 작업본이 바뀌었을 수 있습니다. 이름을 바꾸거나 닫은 뒤 상태를 다시 불러오세요.")
  }
  return <dialog ref={dialogRef} className="dialog-scrim" aria-labelledby="branch-create-title" onCancel={(event) => { event.preventDefault(); if (!busy) onClose() }}>
    <section className="dialog branch-dialog">
      <header><div><p className="overline">NEW WORKING LINE</p><h2 id="branch-create-title">새 분기 만들기</h2></div><button className="icon-button" type="button" disabled={busy} onClick={onClose} aria-label="분기 만들기 닫기"><X /></button></header>
      <form onSubmit={submit}>
        <p className="branch-source"><GitBranch /><span><strong>{source.label}</strong><small>{source.id}</small></span></p>
        <label className="field-label">분기 이름<input autoFocus disabled={busy} value={name} onChange={(event) => setName(event.target.value)} maxLength={80} required /></label>
        <p className="branch-help">정식 장면과 기획만 복사합니다. 초안, 피드백, 편집안, 실행 기록은 복사하지 않으며 만든 뒤에도 현재 분기를 유지합니다.</p>
        {error ? <p className="dialog-error" role="alert">{error}</p> : null}
        <footer><button className="button quiet" type="button" disabled={busy} onClick={onClose}>취소</button><button className="button primary" type="submit" disabled={busy || !name.trim()}>{busy ? <LoaderCircle className="spin" /> : <Plus />} 분기 만들기</button></footer>
      </form>
    </section>
  </dialog>
}
