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
  const close = () => { if (busy) return; if (!dirty || window.confirm("병합 검토에서 선택한 내용을 버릴까요?")) props.onClose() }
  const load = async () => { if (!sourceId) return; setBusy(true); setError(null); try { const value = await createMergePreview({ sourceBranchId: sourceId, expectedHead: props.expectedHead, baseWorkspaceHash: props.workspaceHash }, props.currentBranchId); setPreview(value); setChoices(Object.fromEntries(value.items.filter((item) => !item.conflict && item.kind === "scene").map((item) => [item.key, "source"]))) } catch (cause: unknown) { setError(cause instanceof Error ? cause.message : "병합 미리보기를 만들지 못했습니다.") } finally { setBusy(false) } }
  const submit = async (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!preview) return
    const resolutions: MergeResolution[] = []
    for (const item of preview.items) {
      const choice = choices[item.key]
      if (choice === "source" || choice === "target") resolutions.push({ key: item.key, choice })
      if (choice === "custom") { const result = buildCustomResolution(item, custom[item.key] ?? initialCustomDraft(item)); if (!result.ok) { setError(result.message); return } resolutions.push(result.resolution) }
    }
    if (resolutions.length !== preview.items.length) { setError("모든 충돌과 기획·그래프 차이를 명시적으로 선택하세요."); return }
    setBusy(true); setError(null)
    try { const created = await sealMergePreview(preview.id, { previewHash: preview.hash, resolutions }, props.currentBranchId); await props.onSealed(created.id); props.onClose() } catch (cause: unknown) { setError(cause instanceof Error ? cause.message : "병합 제안을 봉인하지 못했습니다.") } finally { setBusy(false) }
  }
  return <dialog ref={dialogRef} className="dialog-scrim" onCancel={(event) => { event.preventDefault(); close() }} aria-labelledby="merge-title"><section className="dialog merge-dialog"><header><div><p className="overline">MERGE PREVIEW</p><h2 id="merge-title">분기 병합 검토</h2></div><button className="icon-button" type="button" disabled={busy} onClick={close} aria-label="병합 검토 닫기"><X /></button></header>{preview ? <form onSubmit={submit}><p className="mechanical-note"><GitMerge /> 이 단계는 원자적 V2 변경 제안만 만듭니다. 기준본 반영은 개정 검토에서 별도로 승인합니다.</p><div className="merge-identities"><span>출처 <strong>{preview.sourceName}</strong><code>{preview.sourceHead}</code></span><span>대상 <strong>{preview.targetName}</strong><code>{preview.targetHead}</code></span></div><div className="merge-items">{preview.items.map((item) => <article key={item.key}><header><strong>{item.title}</strong><span>{item.conflict ? "충돌" : "깨끗한 변경"} · {item.kind}</span></header><p>{item.reason}</p><div className="merge-three-way"><MergeValuePanel label="공통 기준" item={item} value={item.base} unknownBase={!item.baseKnown} /><MergeValuePanel label="출처 분기" item={item} value={item.source} /><MergeValuePanel label="현재 대상" item={item} value={item.target} /></div><fieldset disabled={busy}><legend className="sr-only">{item.title} 해결 방법</legend>{(["source", "target", "custom"] as const).map((choice) => <label key={choice}><input type="radio" name={item.key} checked={choices[item.key] === choice} onChange={() => { setChoices((current) => ({ ...current, [item.key]: choice })); if (choice === "custom" && !custom[item.key]) setCustom((current) => ({ ...current, [item.key]: initialCustomDraft(item) })) }} /> {choice === "source" ? "출처" : choice === "target" ? "대상" : "직접 수정"}</label>)}</fieldset>{choices[item.key] === "custom" ? <MergeCustomEditor item={item} draft={custom[item.key] ?? initialCustomDraft(item)} disabled={busy} onChange={(draft) => setCustom((current) => ({ ...current, [item.key]: draft }))} /> : null}</article>)}</div>{error ? <p className="dialog-error" role="alert">{error}</p> : null}<footer><button className="button quiet" type="button" disabled={busy} onClick={close}>취소</button><button className="button primary" type="submit" disabled={busy}>{busy ? <LoaderCircle className="spin" /> : <GitMerge />} V2 병합 제안 만들기</button></footer></form> : <div className="merge-source"><label className="field-label">병합할 출처 분기<select disabled={busy} value={sourceId} onChange={(event) => setSourceId(event.target.value)}>{sources.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label><p>현재 분기는 대상으로만 사용하며 출처 분기는 변경하지 않습니다.</p>{error ? <p className="dialog-error" role="alert">{error}</p> : null}<button className="button primary" type="button" disabled={busy || !sourceId} onClick={() => void load()}>{busy ? <LoaderCircle className="spin" /> : <GitMerge />} 미리보기 만들기</button></div>}</section></dialog>
}
