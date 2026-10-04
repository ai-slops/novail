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
          {selection ? <button className="button quiet compact" type="button" disabled={busy} onClick={() => onProtect(selection)}><LockKeyhole /> 선택 문장 보호</button> : null}
          <button className="button quiet compact" type="button" disabled={busy || text === savedText} onClick={() => onDraft(text)}><Save /> 초안 저장</button>
          <button className="button primary compact" type="button" disabled={busy || draftStale || text === scene.text} onClick={() => onCandidate(text)}><Sparkles /> 편집안 검토</button>
        </div>
      </div>
      {draftStale ? <details className="draft-conflict"><summary>기준본이 바뀌었습니다. 저장된 초안을 다시 검토하세요.</summary><h3>현재 기준본</h3><p>{scene.text}</p><button className="button quiet" type="button" disabled={busy} onClick={() => { if (window.confirm("현재 기준본과 초안을 비교했습니까? 이 초안을 새 기준본에 연결하면 다시 편집안을 만들 수 있습니다.")) void onRebase(text) }}>검토 완료 · 새 기준본에 연결</button></details> : null}
      <section className="paper" aria-label="원고 편집기">
        <div className="paper-meta"><span><Type /> {Array.from(text.replace(/\s/g, "")).length.toLocaleString("ko-KR")}자</span><span><Bookmark /> {scene.storyTime}</span><span><Check /> {text !== savedText ? "저장하지 않은 변경" : draftText !== undefined && draftText !== scene.text ? "저장된 초안 · 채택 전" : "기준본에서 작업 중"}</span></div>
        <textarea ref={areaRef} className="manuscript" aria-label={`${scene.title} 원고`} value={text} onChange={(event) => setText(event.target.value)} onSelect={captureSelection} spellCheck="false" />
        <footer className="paper-footer"><span>NOVAIL 원고</span><span>— {scene.chapter} —</span></footer>
      </section>
    </main>
  )
}
