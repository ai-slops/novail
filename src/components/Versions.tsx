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
    <header className="view-header"><div><p className="overline">IMMUTABLE HISTORY</p><h2>Versions</h2></div><button className="button primary" type="button" disabled={props.busy || props.branches.length < 2} onClick={() => setMerging(true)}><GitBranch /> Merge another branch</button></header>
    <BranchControls branches={props.branches} currentBranchId={props.currentBranchId} source={currentSnapshot} busy={props.busy} onSwitch={props.onSwitchBranch} onCreate={props.onCreateBranch} onRefresh={props.onRefresh} />
    <section className="edition-section" aria-labelledby="snapshot-heading">
      <SectionHeading id="snapshot-heading" eyebrow="WORKING SNAPSHOTS" title="Working snapshots" count={props.snapshots.length} />
      <div className="version-list snapshot-list">{props.snapshots.toReversed().map((snapshot) => <SnapshotCard key={snapshot.id} snapshot={snapshot} branchId={props.currentBranchId} current={snapshot.id === props.head} busy={props.busy} onRestore={props.onRestore} onFork={() => setForkSource(snapshot)} onPublish={() => setSelection({ snapshot, expectedHead: props.head, expectedBranchId: props.currentBranchId })} />)}</div>
    </section>
    <section className="edition-section" aria-labelledby="edition-heading">
      <SectionHeading id="edition-heading" eyebrow="PUBLISHED EDITIONS" title="Published editions" count={props.editions.length} />
      {props.editions.length > 0 ? <div className="edition-list">{props.editions.toReversed().map((edition) => <EditionCard key={edition.id} edition={edition} />)}</div> : <div className="empty-review edition-empty"><ShieldCheck /><strong>No published editions yet</strong><p>Review and explicitly approve a working snapshot to record an immutable edition here.</p></div>}
    </section>
    {props.latestRun ? <section className="run-strip"><Clock3 /><div><strong>Latest run</strong><p>{props.latestRun.purpose} · {props.latestRun.state}</p></div></section> : null}
    {selection ? <PublishDialog selection={selection} onClose={() => setSelection(null)} onPublished={(edition) => { setSelection(null); props.onPublished(edition, selection.expectedBranchId) }} /> : null}
    {forkSource ? <CreateBranchDialog source={forkSource} busy={props.busy} onClose={() => setForkSource(null)} onCreate={async (name) => { const created = await props.onCreateBranch(name, forkSource.id); if (created) setForkSource(null); return created }} /> : null}
    {merging ? <MergeDialog branches={props.branches} currentBranchId={props.currentBranchId} expectedHead={props.head} workspaceHash={props.workspaceHash} onClose={() => setMerging(false)} onSealed={async () => { await props.onRevisionRefresh() }} /> : null}
  </main>
}

function SectionHeading({ id, eyebrow, title, count }: Readonly<{ id: string; eyebrow: string; title: string; count: number }>) {
  return <header className="section-heading"><div><p className="overline">{eyebrow}</p><h3 id={id}>{title}</h3></div><span>{count.toLocaleString("en-US")}</span></header>
}

function ExportLinks({ url }: Readonly<{ url: (format: (typeof formats)[number]["value"]) => string }>) {
  return <div className="export-links" aria-label="Export formats">{formats.map((format) => <a key={format.value} className="button quiet compact" href={url(format.value)} download={`novail-export.${format.extension}`}><Download /> {format.label}</a>)}</div>
}

function SnapshotCard({ snapshot, branchId, current, busy, onRestore, onFork, onPublish }: Readonly<{ snapshot: Snapshot; branchId: string; current: boolean; busy: boolean; onRestore: (snapshot: Snapshot) => Promise<void>; onFork: () => void; onPublish: () => void }>) {
  const hasScenes = Object.keys(snapshot.sceneTexts).length > 0
  return <article>
    <div className="version-rail"><span>{current ? <GitBranch /> : <Clock3 />}</span></div>
    <div className="ledger-copy"><small>{new Date(snapshot.createdAt).toLocaleString("en-US")}</small><h4>{snapshot.label}</h4><p>Frozen scenes: {Object.keys(snapshot.sceneTexts).length}</p><code>{snapshot.id}</code></div>
    <div className="ledger-actions"><ExportLinks url={(format) => snapshotExportUrl(snapshot.id, format, branchId)} /><div className="snapshot-actions">
      <ForkSnapshotButton snapshot={snapshot} busy={busy} onCreate={onFork} />
      <button className="button quiet compact" type="button" disabled={busy || current} onClick={() => { if (window.confirm("Restore this version as the new canonical text? Existing history is preserved.")) void onRestore(snapshot) }}>{current ? <><Check /> Current version</> : <><RotateCcw /> Restore</>}</button>
      <button className="button primary compact" type="button" disabled={busy || !hasScenes} onClick={onPublish}><FileCheck2 /> Publish edition</button>
    </div></div>
  </article>
}

function EditionCard({ edition }: Readonly<{ edition: EditionSummary }>) {
  return <article className="edition-card"><div className="edition-seal"><FileCheck2 /></div>
    <div className="ledger-copy"><small>{new Date(edition.createdAt).toLocaleString("en-US")} · {edition.publishedBy}</small><h4>{edition.title}</h4><dl>
      <div><dt>Source snapshot</dt><dd>{edition.snapshotId}</dd></div><div><dt>Source branch</dt><dd>{edition.sourceBranchId ?? "Legacy record · Branch unavailable"}</dd></div>
      <div><dt>Manifest hash</dt><dd><code>{edition.manifestHash}</code></dd></div><div><dt>Previous edition</dt><dd>{edition.revisionOf ?? "First edition"}</dd></div>
      <div><dt>Scenes</dt><dd>{edition.sceneCount}</dd></div>
    </dl></div><ExportLinks url={(format) => editionExportUrl(edition.id, format)} />
  </article>
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
      setPreview(next); setTitle(next.latestEdition ? `${next.title} revised edition` : `${next.title} first edition`)
    } catch (cause: unknown) { setError(cause instanceof ApiError ? cause.message : "Could not load the manifest preview. Check the connection and try again.") }
    finally { setLoading(false) }
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
    } catch (cause: unknown) { setError(cause instanceof ApiError ? cause.message : "Could not publish the edition. Check the canonical state and connection, then try again.") }
    finally { setPublishing(false) }
  }
  const approval = preview?.latestEdition ? `I confirm that this record is an explicit revision of ${preview.latestEdition.title}, becomes immutable alongside the previous edition after saving, and is not published to an external service.` : "I confirm that this snapshot will be recorded as an immutable edition inside the workspace, cannot be edited, overwritten, or deleted after saving, and is not published to an external service."
  return <dialog ref={dialogRef} className="dialog-scrim" aria-labelledby="publish-title" onCancel={(event) => { event.preventDefault(); if (!publishing) onClose() }}><section className="dialog publish-dialog">
    <header><div><p className="overline">HUMAN APPROVAL</p><h2 id="publish-title">Approve edition publication</h2></div><button className="icon-button" type="button" disabled={publishing} onClick={onClose} aria-label="Close publication approval"><X /></button></header>
    {loading ? <div className="preview-state" role="status"><LoaderCircle className="spin" /><strong>Creating manifest preview</strong><p>Freezing the selected snapshot and project metadata.</p></div> : error && !preview ? <div className="preview-state error" role="alert"><strong>Could not prepare the preview</strong><p>{error}</p><button className="button quiet" type="button" onClick={() => void loadPreview()}>Reload</button></div> : preview ? <form onSubmit={submit}>
      <p className="publication-scope"><ShieldCheck /> This records an immutable edition inside the NOVAIL workspace. It does not upload or publish to external stores or platforms.</p>
      <label className="field-label">Edition title<input ref={titleRef} value={title} onChange={(event) => setTitle(event.target.value)} required /></label>
      <div className="manifest-summary"><div><span>Source snapshot</span><code>{preview.snapshotId}</code></div><div><span>Manifest hash</span><code>{preview.manifestHash}</code></div><div><span>Length</span><strong>{preview.sceneCount} scenes · {preview.characterCount.toLocaleString("en-US")} characters</strong></div>{preview.latestEdition ? <div><span>Revision of</span><strong>{preview.latestEdition.title} · {preview.latestEdition.id}</strong></div> : null}</div>
      <section className="preview-scenes" aria-labelledby="preview-scenes-title"><header><strong id="preview-scenes-title">Included scenes</strong><span>Saved drafts are excluded</span></header><ol>{preview.scenes.map((scene) => <li key={scene.id}><span>{scene.chapter}</span><strong>{scene.title}</strong><small>{scene.characters.toLocaleString("en-US")} characters</small></li>)}</ol></section>
      <label className="approval-check"><input type="checkbox" checked={approved} onChange={(event) => setApproved(event.target.checked)} /><span>{approval}</span></label>
      {error ? <p className="dialog-error" role="alert">{error}</p> : null}
      <footer><button className="button quiet" type="button" disabled={publishing} onClick={onClose}>Cancel</button><button className="button primary" type="submit" disabled={publishing || !approved || !title.trim()}>{publishing ? <LoaderCircle className="spin" /> : <Send />} Publish edition</button></footer>
    </form> : null}
  </section></dialog>
}
