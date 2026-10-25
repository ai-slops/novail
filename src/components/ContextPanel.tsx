import { AlertCircle, ArrowRight, Bot, Check, ChevronRight, MessageSquareText, Send, ShieldCheck, X } from "lucide-react"
import { useEffect, useState } from "react"
import type { Candidate, Feedback, Scene, Settings } from "../types"
import type { ChangeSet } from "../../packages/revision/contracts"

type ContextProps = Readonly<{
  scene: Scene
  feedback: readonly Feedback[]
  candidates: readonly Candidate[]
  changeSets: readonly ChangeSet[]
  settings: Settings
  busy: boolean
  open: boolean
  onClose: () => void
  onOpenReview: () => void
  onDirtyChange: (dirty: boolean) => void
  onRepair: (feedback: Feedback) => void
  onSubmit: (text: string, scope: string) => Promise<boolean>
  onCommit: (candidate: Candidate) => Promise<void>
  onReject: (candidate: Candidate) => Promise<void>
  onResolve: (feedback: Feedback, decision: "close" | "defer" | "reopen", note: string) => Promise<void>
}>

export function ContextPanel(props: ContextProps) {
  const [text, setText] = useState("")
  const [scope, setScope] = useState("scene")
  useEffect(() => { props.onDirtyChange(Boolean(text.trim())) }, [text, props.onDirtyChange])
  useEffect(() => () => props.onDirtyChange(false), [props.onDirtyChange])
  const active = props.candidates.findLast((candidate) => candidate.status === "pending") ?? props.candidates.at(-1)
  const activeV2 = props.changeSets.findLast((changeSet) => changeSet.status === "pending") ?? props.changeSets.at(-1)
  const submit = async () => { if (!text.trim()) return; const succeeded = await props.onSubmit(text.trim(), scope); if (succeeded) setText("") }
  const resolve = (feedback: Feedback, decision: "close" | "defer" | "reopen") => { const note = window.prompt("Briefly explain this decision. Empty notes are not saved.", ""); if (!note?.trim()) return; void props.onResolve(feedback, decision, note.trim()) }
  return (
    <aside className={`context-panel ${props.open ? "is-open" : ""}`} aria-label="Context and feedback">
      <div className="panel-heading"><div><p className="overline">EDITORIAL CONTEXT</p><h2>Context and feedback</h2></div><button className="icon-button mobile-only" type="button" onClick={props.onClose} aria-label="Close panel"><X /></button></div>
      <div className={`provider-note ${props.settings.providerConfigured ? "live" : "demo"}`}>
        <Bot /><div><strong>{props.settings.providerConfigured ? "Model provider configured" : "Local example mode"}</strong><p>{props.settings.providerConfigured ? "Check the run result for the actual connection and usage." : "Suggestions are rule-based examples and are never applied automatically."}</p></div>
      </div>
      <section className="context-section"><div className="section-title"><span>Scene context</span><ChevronRight /></div><p className="scene-summary">{props.scene.summary}</p><div className="fact-grid"><span>Story time<strong>{props.scene.storyTime}</strong></span><span>Characters<strong>{props.scene.characters.join(", ") || "None"}</strong></span></div></section>
      <section className="context-section">
        <div className="section-title"><span>New feedback</span><MessageSquareText /></div>
        <label className="field-label" htmlFor="feedback">Editorial intent</label>
        <textarea id="feedback" className="feedback-input" value={text} onChange={(event) => setText(event.target.value)} placeholder="Describe what you want to improve in this scene." />
        <div className="submit-row">
          <select value={scope} onChange={(event) => setScope(event.target.value)} aria-label="Feedback scope">
            <option value="scene">Scene</option><option value="chapter">Chapter</option><option value="project">Entire project</option>
          </select>
          <button className="button primary" type="button" disabled={props.busy || !text.trim()} onClick={submit}><Send /> Save and choose scope</button>
        </div>
        <p className="branch-help">After recording the feedback scope, choose the scenes and plans to revise.</p>
      </section>
      {activeV2 ? <section className="candidate-card v2-summary">
        <div className="candidate-label"><span><ShieldCheck /> V2 change set · {activeV2.status}</span><small>{activeV2.reason}</small></div>
        <p>{activeV2.entries.length} changes · {activeV2.impact.reviewSet.length} impact reviews</p>
        <button className="button primary" type="button" onClick={props.onOpenReview}>Open Revisions</button>
      </section> : active ? <CandidateCard candidate={active} busy={props.busy} onCommit={props.onCommit} onReject={props.onReject} /> : <div className="empty-review">
        <ShieldCheck /><strong>No edits awaiting review</strong><p>Leave feedback or edit the manuscript directly to create a new change set.</p>
      </div>}
      <section className="feedback-history">
        <div className="section-title"><span>Feedback history</span><strong>{props.feedback.length}</strong></div>
        {props.feedback.toReversed().map((item) => <article key={item.id}>
          <span className="state-dot" /><p>{item.text}</p><small>{item.scope} · {item.state}</small>
          <div className="feedback-actions">
            <button type="button" disabled={props.busy} onClick={() => props.onRepair(item)}>Propose revision</button>
            <button type="button" disabled={props.busy} onClick={() => resolve(item, "close")}>Close</button>
            <button type="button" disabled={props.busy} onClick={() => resolve(item, "defer")}>Defer</button>
            {item.state !== "open" ? <button type="button" disabled={props.busy} onClick={() => resolve(item, "reopen")}>Reopen</button> : null}
          </div>
        </article>)}
      </section>
    </aside>
  )
}

function CandidateCard({ candidate, busy, onCommit, onReject }: Readonly<{ candidate: Candidate; busy: boolean; onCommit: (value: Candidate) => Promise<void>; onReject: (value: Candidate) => Promise<void> }>) {
  const actionable = candidate.status === "pending"
   return <section className="candidate-card">
     <div className="candidate-label"><span><AlertCircle /> Legacy V1 · {candidate.status}</span><small>{candidate.reason}</small></div>
     <div className="diff-block before"><span>Before</span><p>{candidate.before}</p></div>
     <div className="diff-arrow"><ArrowRight /></div>
     <div className="diff-block after"><span>Proposal</span><p>{candidate.after}</p></div>
     {candidate.reviewSet.length > 0 ? <div className="impact-list">
       <strong>{candidate.reviewSet.length} impact reviews</strong>
       {candidate.reviewSet.map((item) => <span key={`${item.sceneId}-${item.title}`}><Check /> {item.title} · {item.reason}</span>)}
     </div> : null}
     {actionable ? <div className="candidate-actions">
       <button className="button quiet" type="button" disabled={busy} onClick={() => onReject(candidate)}><X /> Reject</button>
       <button className="button primary" type="button" disabled={busy} onClick={() => onCommit(candidate)}><Check /> Move to V2 review</button>
     </div> : null}
   </section>
}
