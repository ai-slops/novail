import { X } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import type { SyntheticEvent } from "react"
import type { ModalKind } from "../types"

type DialogProps = Readonly<{ kind: Exclude<ModalKind, null>; busy: boolean; onClose: () => void; onSubmit: (primary: string, secondary: string) => Promise<void> }>
const copy = {
  project: { overline: "NEW WORLD", title: "New project", primary: "Project title", secondary: "Writing direction", action: "Create project" },
  scene: { overline: "NEW SCENE", title: "New scene", primary: "Scene title", secondary: "Opening line or note", action: "Add scene" },
  plan: { overline: "NEW PLAN", title: "New plan card", primary: "Plan title", secondary: "Goals and decision criteria", action: "Add plan" },
} as const

export function EntityDialog({ kind, busy, onClose, onSubmit }: DialogProps) {
  const [primary, setPrimary] = useState("")
  const [secondary, setSecondary] = useState("")
  const firstRef = useRef<HTMLInputElement>(null)
  const dialogRef = useRef<HTMLDialogElement>(null)
  const labels = copy[kind]
  useEffect(() => { dialogRef.current?.showModal(); firstRef.current?.focus() }, [])
  const submit = async (event: SyntheticEvent<HTMLFormElement>) => { event.preventDefault(); if (!primary.trim() || !secondary.trim()) return; await onSubmit(primary.trim(), secondary.trim()) }
  return <dialog
    ref={dialogRef}
    className="dialog-scrim"
    aria-labelledby="dialog-title"
    onCancel={(event) => { event.preventDefault(); onClose() }}
    onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}
  >
    <section className="dialog">
      <header>
        <div><p className="overline">{labels.overline}</p><h2 id="dialog-title">{labels.title}</h2></div>
        <button className="icon-button" type="button" onClick={onClose} aria-label="Close"><X /></button>
      </header>
      <form onSubmit={submit}>
        <label className="field-label">{labels.primary}<input ref={firstRef} value={primary} onChange={(event) => setPrimary(event.target.value)} required /></label>
        <label className="field-label">{labels.secondary}<textarea value={secondary} onChange={(event) => setSecondary(event.target.value)} required /></label>
        <footer>
          <button className="button quiet" type="button" onClick={onClose}>Cancel</button>
          <button className="button primary" type="submit" disabled={busy || !primary.trim() || !secondary.trim()}>{busy ? "Saving…" : labels.action}</button>
        </footer>
      </form>
    </section>
  </dialog>
}
