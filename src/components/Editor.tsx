import { Bookmark, Check, LockKeyhole, Save, Sparkles, Type } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import type { Scene } from "../types"

type EditorProps = Readonly<{
  scene: Scene
  draftText: string | undefined
  draftStale: boolean
  onRebase: (text: string) => Promise<void>
  busy: boolean
  onDraft: (text: string) => Promise<void>
  onCandidate: (text: string) => Promise<void>
  onProtect: (quote: string) => Promise<void>
  onDirtyChange: (dirty: boolean) => void
}>

export function Editor({ scene, draftText, draftStale, onRebase, busy, onDraft, onCandidate, onProtect, onDirtyChange }: EditorProps) {
  const savedText = draftText ?? scene.text
  const [text, setText] = useState(savedText)
  const [selection, setSelection] = useState("")
  const areaRef = useRef<HTMLTextAreaElement>(null)
  useEffect(() => { setText(savedText); setSelection("") }, [scene.id, savedText])
  useEffect(() => { onDirtyChange(text !== savedText) }, [text, savedText, onDirtyChange])
  const captureSelection = () => {
    const area = areaRef.current
    if (area) setSelection(area.value.slice(area.selectionStart, area.selectionEnd).trim())
  }
  return (
    <main className="manuscript-pane" id="main-content">
      <div className="manuscript-toolbar">
        <div><span className="eyebrow">{scene.chapter}</span><h2>{scene.title}</h2></div>
        <div className="toolbar-actions">
          {selection ? <button className="button quiet compact" type="button" disabled={busy} onClick={() => onProtect(selection)}><LockKeyhole /> Protect selected sentence</button> : null}
          <button className="button quiet compact" type="button" disabled={busy || text === savedText} onClick={() => onDraft(text)}><Save /> Save draft</button>
          <button className="button primary compact" type="button" disabled={busy || draftStale || text === scene.text} onClick={() => onCandidate(text)}><Sparkles /> Review edit</button>
        </div>
      </div>
      {draftStale ? <details className="draft-conflict">
        <summary>The canonical text changed. Review the saved draft again.</summary>
        <h3>Current canonical text</h3>
        <p>{scene.text}</p>
        <button className="button quiet" type="button" disabled={busy} onClick={() => {
          if (window.confirm("Have you compared the draft with the current canonical text? Linking this draft to the new canonical text lets you create another edit.")) void onRebase(text)
        }}>Review complete · Link to new canonical text</button>
      </details> : null}
      <section className="paper" aria-label="Manuscript editor">
        <div className="paper-meta"><span><Type /> {Array.from(text.replace(/\s/g, "")).length.toLocaleString("en-US")} characters</span><span><Bookmark /> {scene.storyTime}</span><span><Check /> {text !== savedText ? "Unsaved changes" : draftText !== undefined && draftText !== scene.text ? "Saved draft · Not adopted" : "Working from canonical text"}</span></div>
        <textarea ref={areaRef} className="manuscript" aria-label={`${scene.title} manuscript`} value={text} onChange={(event) => setText(event.target.value)} onSelect={captureSelection} spellCheck="false" />
        <footer className="paper-footer"><span>NOVAIL manuscript</span><span>— {scene.chapter} —</span></footer>
      </section>
    </main>
  )
}
