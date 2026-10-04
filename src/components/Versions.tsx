import { Check, Clock3, Download, FileCheck2, GitBranch, LoaderCircle, RotateCcw, Send, ShieldCheck, X } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import type { SyntheticEvent } from "react"
import { ApiError, editionExportUrl, getExportPreview, publishEdition, snapshotExportUrl } from "../api"
import type { BranchSummary, EditionSummary, ExportPreview, Run, Snapshot } from "../types"
import { BranchControls, CreateBranchDialog, ForkSnapshotButton } from "./BranchControls"
import { MergeDialog } from "./MergeDialog"

type VersionsProps = Readonly<{
  snapshots: readonly Snapshot[]
  editions: readonly EditionSummary[]
  head: string
  workspaceHash: string
  busy: boolean
  latestRun: Run | undefined
  branches: readonly BranchSummary[]
  currentBranchId: string
  onSwitchBranch: (id: string) => Promise<void>
  onCreateBranch: (name: string, sourceSnapshotId: string) => Promise<boolean>
  onRefresh: () => Promise<void>
  onRevisionRefresh: () => Promise<void>
  onRestore: (snapshot: Snapshot) => Promise<void>
  onPublished: (edition: EditionSummary, branchId: string) => void
}>

const formats = [
  { value: "markdown", label: "Markdown", extension: "md" },
  { value: "docx", label: "DOCX", extension: "docx" },
  { value: "manifest", label: "Manifest", extension: "json" },
] as const

export function Versions(props: VersionsProps) {
  const [selection, setSelection] = useState<Readonly<{ snapshot: Snapshot; expectedHead: string; expectedBranchId: string }> | null>(null)
  const [forkSource, setForkSource] = useState<Snapshot | null>(null)
  const [merging, setMerging] = useState(false)
  const currentSnapshot = props.snapshots.find((snapshot) => snapshot.id === props.head)
  return <main className="secondary-view editions-view" id="main-content">
    <header className="view-header"><div><p className="overline">IMMUTABLE HISTORY</p><h2>버전 기록</h2></div><button className="button primary" type="button" disabled={props.busy || props.branches.length < 2} onClick={() => setMerging(true)}><GitBranch /> 다른 분기 병합</button></header>
    <BranchControls branches={props.branches} currentBranchId={props.currentBranchId} source={currentSnapshot} busy={props.busy} onSwitch={props.onSwitchBranch} onCreate={props.onCreateBranch} onRefresh={props.onRefresh} />
    <section className="edition-section" aria-labelledby="snapshot-heading">
      <SectionHeading id="snapshot-heading" eyebrow="WORKING SNAPSHOTS" title="작업본 스냅샷" count={props.snapshots.length} />
      <div className="version-list snapshot-list">{props.snapshots.toReversed().map((snapshot) => <SnapshotCard key={snapshot.id} snapshot={snapshot} branchId={props.currentBranchId} current={snapshot.id === props.head} busy={props.busy} onRestore={props.onRestore} onFork={() => setForkSource(snapshot)} onPublish={() => setSelection({ snapshot, expectedHead: props.head, expectedBranchId: props.currentBranchId })} />)}</div>
    </section>
    <section className="edition-section" aria-labelledby="edition-heading">
      <SectionHeading id="edition-heading" eyebrow="PUBLISHED EDITIONS" title="발행한 판본" count={props.editions.length} />
      {props.editions.length > 0 ? <div className="edition-list">{props.editions.toReversed().map((edition) => <EditionCard key={edition.id} edition={edition} />)}</div> : <div className="empty-review edition-empty"><ShieldCheck /><strong>아직 발행한 판본이 없습니다</strong><p>작업본 스냅샷을 검토하고 명시적으로 승인하면 변경할 수 없는 판본이 이곳에 기록됩니다.</p></div>}
    </section>
    {props.latestRun ? <section className="run-strip"><Clock3 /><div><strong>최근 실행</strong><p>{props.latestRun.purpose} · {props.latestRun.state}</p></div></section> : null}
    {selection ? <PublishDialog selection={selection} onClose={() => setSelection(null)} onPublished={(edition) => { setSelection(null); props.onPublished(edition, selection.expectedBranchId) }} /> : null}
    {forkSource ? <CreateBranchDialog source={forkSource} busy={props.busy} onClose={() => setForkSource(null)} onCreate={async (name) => { const created = await props.onCreateBranch(name, forkSource.id); if (created) setForkSource(null); return created }} /> : null}
    {merging ? <MergeDialog branches={props.branches} currentBranchId={props.currentBranchId} expectedHead={props.head} workspaceHash={props.workspaceHash} onClose={() => setMerging(false)} onSealed={async () => { await props.onRevisionRefresh() }} /> : null}
  </main>
}

function SectionHeading({ id, eyebrow, title, count }: Readonly<{ id: string; eyebrow: string; title: string; count: number }>) {
  return <header className="section-heading"><div><p className="overline">{eyebrow}</p><h3 id={id}>{title}</h3></div><span>{count.toLocaleString("ko-KR")}</span></header>
}

function ExportLinks({ url }: Readonly<{ url: (format: (typeof formats)[number]["value"]) => string }>) {
  return <div className="export-links" aria-label="내보내기 형식">{formats.map((format) => <a key={format.value} className="button quiet compact" href={url(format.value)} download={`novail-export.${format.extension}`}><Download /> {format.label}</a>)}</div>
}

function SnapshotCard({ snapshot, branchId, current, busy, onRestore, onFork, onPublish }: Readonly<{ snapshot: Snapshot; branchId: string; current: boolean; busy: boolean; onRestore: (snapshot: Snapshot) => Promise<void>; onFork: () => void; onPublish: () => void }>) {
  const hasScenes = Object.keys(snapshot.sceneTexts).length > 0
  return <article>
    <div className="version-rail"><span>{current ? <GitBranch /> : <Clock3 />}</span></div>
    <div className="ledger-copy"><small>{new Date(snapshot.createdAt).toLocaleString("ko-KR")}</small><h4>{snapshot.label}</h4><p>{Object.keys(snapshot.sceneTexts).length}개 장면이 고정된 스냅샷</p><code>{snapshot.id}</code></div>
    <div className="ledger-actions"><ExportLinks url={(format) => snapshotExportUrl(snapshot.id, format, branchId)} /><div className="snapshot-actions"><ForkSnapshotButton snapshot={snapshot} busy={busy} onCreate={onFork} /><button className="button quiet compact" type="button" disabled={busy || current} onClick={() => { if (window.confirm("이 버전의 원고를 새 기준본으로 복원할까요? 기존 이력은 보존됩니다.")) void onRestore(snapshot) }}>{current ? <><Check /> 현재 버전</> : <><RotateCcw /> 복원</>}</button><button className="button primary compact" type="button" disabled={busy || !hasScenes} onClick={onPublish}><FileCheck2 /> 판본 발행</button></div></div>
  </article>
}

function EditionCard({ edition }: Readonly<{ edition: EditionSummary }>) {
  return <article className="edition-card"><div className="edition-seal"><FileCheck2 /></div><div className="ledger-copy"><small>{new Date(edition.createdAt).toLocaleString("ko-KR")} · {edition.publishedBy}</small><h4>{edition.title}</h4><dl><div><dt>출처 스냅샷</dt><dd>{edition.snapshotId}</dd></div><div><dt>출처 분기</dt><dd>{edition.sourceBranchId ?? "이전 기록 · 분기 정보 없음"}</dd></div><div><dt>Manifest hash</dt><dd><code>{edition.manifestHash}</code></dd></div><div><dt>이전 판본</dt><dd>{edition.revisionOf ?? "최초 판본"}</dd></div><div><dt>장면</dt><dd>{edition.sceneCount}개</dd></div></dl></div><ExportLinks url={(format) => editionExportUrl(edition.id, format)} /></article>
}

function PublishDialog({ selection, onClose, onPublished }: Readonly<{ selection: Readonly<{ snapshot: Snapshot; expectedHead: string; expectedBranchId: string }>; onClose: () => void; onPublished: (edition: EditionSummary) => void }>) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const titleRef = useRef<HTMLInputElement>(null)
  const [preview, setPreview] = useState<ExportPreview | null>(null)
  const [title, setTitle] = useState("")
  const [approved, setApproved] = useState(false)
  const [loading, setLoading] = useState(true)
  const [publishing, setPublishing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const loadPreview = async () => {
    setLoading(true); setError(null); setPreview(null); setApproved(false)
    try {
      const next = await getExportPreview(selection.snapshot.id, selection.expectedBranchId)
      setPreview(next); setTitle(next.latestEdition ? `${next.title} 개정판` : `${next.title} 초판`)
    } catch (cause: unknown) {
      setError(cause instanceof ApiError ? cause.message : "Manifest 미리보기를 불러오지 못했습니다. 연결을 확인하고 다시 시도하세요.")
    } finally { setLoading(false) }
  }
  useEffect(() => { dialogRef.current?.showModal(); void loadPreview() }, [])
  useEffect(() => { if (preview) titleRef.current?.focus() }, [preview])
  const submit = async (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!preview || !approved || !title.trim()) return
    setPublishing(true); setError(null)
    try {
      const previous = preview.latestEdition
      const edition = await publishEdition({ title: title.trim(), snapshotId: preview.snapshotId, expectedHead: selection.expectedHead, approvedManifestHash: preview.manifestHash, revisionOf: previous?.id ?? null, approvedPreviousManifestHash: previous?.manifestHash ?? null, decision: "publish", policyVersion: 1 }, selection.expectedBranchId)
      onPublished(edition)
    } catch (cause: unknown) {
      setError(cause instanceof ApiError ? cause.message : "판본을 발행하지 못했습니다. 기준본 상태와 연결을 확인한 뒤 다시 시도하세요.")
    } finally { setPublishing(false) }
  }
  const approval = preview?.latestEdition ? `이 기록이 ${preview.latestEdition.title}의 명시적 개정판이며, 저장 후 이전 판본과 함께 변경할 수 없고 외부 서비스에는 공개되지 않음을 확인했습니다.` : "이 스냅샷을 작업실 안의 변경할 수 없는 판본으로 기록하며, 저장 후 수정·덮어쓰기·삭제할 수 없고 외부 서비스에는 공개되지 않음을 확인했습니다."
  return <dialog ref={dialogRef} className="dialog-scrim" aria-labelledby="publish-title" onCancel={(event) => { event.preventDefault(); if (!publishing) onClose() }}><section className="dialog publish-dialog"><header><div><p className="overline">HUMAN APPROVAL</p><h2 id="publish-title">판본 발행 승인</h2></div><button className="icon-button" type="button" disabled={publishing} onClick={onClose} aria-label="발행 승인 닫기"><X /></button></header>{loading ? <div className="preview-state" role="status"><LoaderCircle className="spin" /><strong>Manifest 미리보기를 만드는 중입니다</strong><p>선택한 스냅샷과 프로젝트 메타데이터를 고정하고 있습니다.</p></div> : error && !preview ? <div className="preview-state error" role="alert"><strong>미리보기를 준비하지 못했습니다</strong><p>{error}</p><button className="button quiet" type="button" onClick={() => void loadPreview()}>다시 불러오기</button></div> : preview ? <form onSubmit={submit}><p className="publication-scope"><ShieldCheck /> 이 동작은 NOVAIL 작업실 안에 변경할 수 없는 판본을 기록합니다. 외부 서점·플랫폼에 업로드하거나 공개하지 않습니다.</p><label className="field-label">판본 제목<input ref={titleRef} value={title} onChange={(event) => setTitle(event.target.value)} required /></label><div className="manifest-summary"><div><span>출처 스냅샷</span><code>{preview.snapshotId}</code></div><div><span>Manifest hash</span><code>{preview.manifestHash}</code></div><div><span>분량</span><strong>{preview.sceneCount}개 장면 · {preview.characterCount.toLocaleString("ko-KR")}자</strong></div>{preview.latestEdition ? <div><span>개정 기준</span><strong>{preview.latestEdition.title} · {preview.latestEdition.id}</strong></div> : null}</div><section className="preview-scenes" aria-labelledby="preview-scenes-title"><header><strong id="preview-scenes-title">포함 장면</strong><span>저장된 초안은 제외됩니다</span></header><ol>{preview.scenes.map((scene) => <li key={scene.id}><span>{scene.chapter}장</span><strong>{scene.title}</strong><small>{scene.characters.toLocaleString("ko-KR")}자</small></li>)}</ol></section><label className="approval-check"><input type="checkbox" checked={approved} onChange={(event) => setApproved(event.target.checked)} /><span>{approval}</span></label>{error ? <p className="dialog-error" role="alert">{error}</p> : null}<footer><button className="button quiet" type="button" disabled={publishing} onClick={onClose}>취소</button><button className="button primary" type="submit" disabled={publishing || !approved || !title.trim()}><Send /> {publishing ? "발행 중…" : "승인하고 판본 발행"}</button></footer></form> : null}</section></dialog>
}
