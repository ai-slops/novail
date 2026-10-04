import { AlertCircle, ArrowRight, Bot, Check, ChevronRight, MessageSquareText, Send, ShieldCheck, X } from "lucide-react"
import { useState } from "react"
import type { Candidate, Feedback, Scene, Settings } from "../types"

type ContextProps = Readonly<{
  scene: Scene
  feedback: readonly Feedback[]
  candidates: readonly Candidate[]
  settings: Settings
  busy: boolean
  open: boolean
  onClose: () => void
  onSubmit: (text: string, scope: string) => Promise<boolean>
  onCommit: (candidate: Candidate) => Promise<void>
  onReject: (candidate: Candidate) => Promise<void>
}>

export function ContextPanel(props: ContextProps) {
  const [text, setText] = useState("")
  const [scope, setScope] = useState("scene")
  const active = props.candidates.findLast((candidate) => candidate.status === "pending") ?? props.candidates.at(-1)
  const submit = async () => { if (!text.trim()) return; const succeeded = await props.onSubmit(text.trim(), scope); if (succeeded) setText("") }
  return (
    <aside className={`context-panel ${props.open ? "is-open" : ""}`} aria-label="문맥과 피드백">
      <div className="panel-heading"><div><p className="overline">EDITORIAL CONTEXT</p><h2>문맥과 피드백</h2></div><button className="icon-button mobile-only" type="button" onClick={props.onClose} aria-label="패널 닫기"><X /></button></div>
      <div className={`provider-note ${props.settings.providerConfigured ? "live" : "demo"}`}>
        <Bot /><div><strong>{props.settings.providerConfigured ? "실제 제공자 연결됨" : "데모 제안 모드"}</strong><p>{props.settings.providerConfigured ? props.settings.mode : "제안은 규칙 기반 예시이며 자동 반영되지 않습니다."}</p></div>
      </div>
      <section className="context-section"><div className="section-title"><span>장면 맥락</span><ChevronRight /></div><p className="scene-summary">{props.scene.summary}</p><div className="fact-grid"><span>시점<strong>{props.scene.storyTime}</strong></span><span>등장인물<strong>{props.scene.characters.join(", ") || "없음"}</strong></span></div></section>
      <section className="context-section"><div className="section-title"><span>새 피드백</span><MessageSquareText /></div><label className="field-label" htmlFor="feedback">편집 의도</label><textarea id="feedback" className="feedback-input" value={text} onChange={(event) => setText(event.target.value)} placeholder="이 장면에서 고치고 싶은 점을 적으세요." /><div className="submit-row"><select value={scope} onChange={(event) => setScope(event.target.value)} aria-label="피드백 범위"><option value="scene">장면</option><option value="chapter">장</option><option value="project">작품 전체</option></select><button className="button primary" type="button" disabled={props.busy || !text.trim()} onClick={submit}><Send /> 등록 후 편집안 생성</button></div></section>
      {active ? <CandidateCard candidate={active} busy={props.busy} onCommit={props.onCommit} onReject={props.onReject} /> : <div className="empty-review"><ShieldCheck /><strong>검토 대기 중인 편집안이 없습니다</strong><p>피드백을 남기거나 원고를 직접 편집해 새 편집안을 만드세요.</p></div>}
      <section className="feedback-history"><div className="section-title"><span>최근 피드백</span><strong>{props.feedback.length}</strong></div>{props.feedback.slice(0, 3).map((item) => <article key={item.id}><span className="state-dot" /><p>{item.text}</p><small>{item.scope} · {item.state}</small></article>)}</section>
    </aside>
  )
}

function CandidateCard({ candidate, busy, onCommit, onReject }: Readonly<{ candidate: Candidate; busy: boolean; onCommit: (value: Candidate) => Promise<void>; onReject: (value: Candidate) => Promise<void> }>) {
  const actionable = candidate.status === "pending"
  return <section className="candidate-card"><div className="candidate-label"><span><AlertCircle /> 개정 검토 · {candidate.status}</span><small>{candidate.reason}</small></div><div className="diff-block before"><span>이전</span><p>{candidate.before}</p></div><div className="diff-arrow"><ArrowRight /></div><div className="diff-block after"><span>제안</span><p>{candidate.after}</p></div>{candidate.reviewSet.length > 0 ? <div className="impact-list"><strong>영향 검토 {candidate.reviewSet.length}건</strong>{candidate.reviewSet.map((item) => <span key={`${item.sceneId}-${item.title}`}><Check /> {item.title} · {item.reason}</span>)}</div> : null}{actionable ? <div className="candidate-actions"><button className="button quiet" type="button" disabled={busy} onClick={() => onReject(candidate)}><X /> 거절</button><button className="button primary" type="button" disabled={busy} onClick={() => onCommit(candidate)}><Check /> 기준본에 반영</button></div> : null}</section>
}
