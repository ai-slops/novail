import { GitMerge, LoaderCircle, X } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import type { SyntheticEvent } from "react"
import type { BranchSummary } from "../types"
import type { MergePreview, MergeResolution } from "../../packages/revision/contracts"
import { createMergePreview, sealMergePreview } from "../api"
import { buildCustomResolution, initialCustomDraft, MergeCustomEditor, MergeValuePanel } from "./MergeValuePanel"
import type { CustomDraft } from "./MergeValuePanel"

type Props = Readonly<{ branches: readonly BranchSummary[]; currentBranchId: string; expectedHead: string; workspaceHash: string; onClose: () => void; onSealed: (id: string) => Promise<void> }>

export function MergeDialog(props: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const sources = props.branches.filter((branch) => branch.id !== props.currentBranchId)
  const [sourceId, setSourceId] = useState(sources[0]?.id ?? "")
  const [preview, setPreview] = useState<MergePreview | null>(null)
  const [choices, setChoices] = useState<Readonly<Record<string, "source" | "target" | "custom">>>({})
  const [custom, setCustom] = useState<Readonly<Record<string, CustomDraft>>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const dirty = preview !== null && (Object.keys(choices).length > 0 || Object.keys(custom).length > 0)
  useEffect(() => { dialogRef.current?.showModal() }, [])
  useEffect(() => { const warn = (event: BeforeUnloadEvent) => { if (dirty) event.preventDefault() }; window.addEventListener("beforeunload", warn); return () => window.removeEventListener("beforeunload", warn) }, [dirty])
  const close = () => { if (busy) return; if (!dirty || window.confirm("Discard the selections in this merge review?")) props.onClose() }
  const load = async () => {
    if (!sourceId) return
    setBusy(true); setError(null)
    try {
      const value = await createMergePreview({ sourceBranchId: sourceId, expectedHead: props.expectedHead, baseWorkspaceHash: props.workspaceHash }, props.currentBranchId)
      setPreview(value)
      setChoices(Object.fromEntries(value.items.filter((item) => !item.conflict && item.kind === "scene").map((item) => [item.key, "source"])))
    } catch (cause: unknown) { setError(cause instanceof Error ? cause.message : "Could not create the merge preview.") }
    finally { setBusy(false) }
  }
  const submit = async (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!preview) return
    const resolutions: MergeResolution[] = []
    for (const item of preview.items) {
      const choice = choices[item.key]
      if (choice === "source" || choice === "target") resolutions.push({ key: item.key, choice })
      if (choice === "custom") {
        const result = buildCustomResolution(item, custom[item.key] ?? initialCustomDraft(item))
        if (!result.ok) { setError(result.message); return }
        resolutions.push(result.resolution)
      }
    }
    if (resolutions.length !== preview.items.length) { setError("Explicitly choose a resolution for every conflict and plan or graph difference."); return }
    setBusy(true); setError(null)
    try {
      const created = await sealMergePreview(preview.id, { previewHash: preview.hash, resolutions }, props.currentBranchId)
      await props.onSealed(created.id)
      props.onClose()
    } catch (cause: unknown) { setError(cause instanceof Error ? cause.message : "Could not seal the merge change set.") }
    finally { setBusy(false) }
  }
  return <dialog ref={dialogRef} className="dialog-scrim" onCancel={(event) => { event.preventDefault(); close() }} aria-labelledby="merge-title">
    <section className="dialog merge-dialog">
      <header><div><p className="overline">MERGE PREVIEW</p><h2 id="merge-title">Merge review</h2></div><button className="icon-button" type="button" disabled={busy} onClick={close} aria-label="Close merge review"><X /></button></header>
      {preview ? <form onSubmit={submit}>
        <p className="mechanical-note"><GitMerge /> This step creates an atomic V2 change set only. Adopt it separately in Revisions.</p>
        <div className="merge-identities"><span>Source <strong>{preview.sourceName}</strong><code>{preview.sourceHead}</code></span><span>Target <strong>{preview.targetName}</strong><code>{preview.targetHead}</code></span></div>
        <div className="merge-items">{preview.items.map((item) => <article key={item.key}>
          <header><strong>{item.title}</strong><span>{item.conflict ? "Conflict" : "Clean change"} · {item.kind}</span></header>
          <p>{item.reason}</p>
          <div className="merge-three-way"><MergeValuePanel label="Common base" item={item} value={item.base} unknownBase={!item.baseKnown} /><MergeValuePanel label="Source branch" item={item} value={item.source} /><MergeValuePanel label="Current target" item={item} value={item.target} /></div>
          <fieldset disabled={busy}>
            <legend className="sr-only">Resolution for {item.title}</legend>
            {(["source", "target", "custom"] as const).map((choice) => <label key={choice}>
              <input
                type="radio"
                name={item.key}
                checked={choices[item.key] === choice}
                onChange={() => {
                  setChoices((current) => ({ ...current, [item.key]: choice }))
                  if (choice === "custom" && !custom[item.key]) setCustom((current) => ({ ...current, [item.key]: initialCustomDraft(item) }))
                }}
              /> {choice === "source" ? "Source" : choice === "target" ? "Target" : "Custom edit"}
            </label>)}
          </fieldset>
          {choices[item.key] === "custom" ? <MergeCustomEditor item={item} draft={custom[item.key] ?? initialCustomDraft(item)} disabled={busy} onChange={(draft) => setCustom((current) => ({ ...current, [item.key]: draft }))} /> : null}
        </article>)}</div>
        {error ? <p className="dialog-error" role="alert">{error}</p> : null}
        <footer><button className="button quiet" type="button" disabled={busy} onClick={close}>Cancel</button><button className="button primary" type="submit" disabled={busy}>{busy ? <LoaderCircle className="spin" /> : <GitMerge />} Create change set proposal</button></footer>
      </form> : <div className="merge-source">
        <label className="field-label">Source branch<select value={sourceId} disabled={busy} onChange={(event) => setSourceId(event.target.value)}>{sources.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label>
        <p>The current branch is the target. The preview does not modify either branch.</p>
        {error ? <p className="dialog-error" role="alert">{error}</p> : null}
        <footer><button className="button quiet" type="button" disabled={busy} onClick={close}>Cancel</button><button className="button primary" type="button" disabled={busy || !sourceId} onClick={() => void load()}>{busy ? <LoaderCircle className="spin" /> : <GitMerge />} Create merge preview</button></footer>
      </div>}
    </section>
  </dialog>
}
