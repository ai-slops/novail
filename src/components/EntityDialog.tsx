import { X } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import type { SyntheticEvent } from "react"
import type { ModalKind } from "../types"

type DialogProps = Readonly<{ kind: Exclude<ModalKind, null>; busy: boolean; onClose: () => void; onSubmit: (primary: string, secondary: string) => Promise<void> }>
const copy = {
  project: { overline: "NEW WORLD", title: "새 프로젝트", primary: "작품 제목", secondary: "집필 방향", action: "프로젝트 만들기" },
  scene: { overline: "NEW SCENE", title: "새 장면", primary: "장면 제목", secondary: "첫 문장 또는 메모", action: "장면 추가" },
  plan: { overline: "NEW PLAN", title: "새 기획 카드", primary: "기획 제목", secondary: "목표와 판단 기준", action: "기획 추가" },
} as const

export function EntityDialog({ kind, busy, onClose, onSubmit }: DialogProps) {
  const [primary, setPrimary] = useState("")
  const [secondary, setSecondary] = useState("")
  const firstRef = useRef<HTMLInputElement>(null)
  const dialogRef = useRef<HTMLDialogElement>(null)
  const labels = copy[kind]
  useEffect(() => { dialogRef.current?.showModal(); firstRef.current?.focus() }, [])
  const submit = async (event: SyntheticEvent<HTMLFormElement>) => { event.preventDefault(); if (!primary.trim() || !secondary.trim()) return; await onSubmit(primary.trim(), secondary.trim()) }
  return <dialog ref={dialogRef} className="dialog-scrim" aria-labelledby="dialog-title" onCancel={(event) => { event.preventDefault(); onClose() }} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><section className="dialog"><header><div><p className="overline">{labels.overline}</p><h2 id="dialog-title">{labels.title}</h2></div><button className="icon-button" type="button" onClick={onClose} aria-label="닫기"><X /></button></header><form onSubmit={submit}><label className="field-label">{labels.primary}<input ref={firstRef} value={primary} onChange={(event) => setPrimary(event.target.value)} required /></label><label className="field-label">{labels.secondary}<textarea value={secondary} onChange={(event) => setSecondary(event.target.value)} required /></label><footer><button className="button quiet" type="button" onClick={onClose}>취소</button><button className="button primary" type="submit" disabled={busy || !primary.trim() || !secondary.trim()}>{busy ? "저장 중…" : labels.action}</button></footer></form></section></dialog>
}
