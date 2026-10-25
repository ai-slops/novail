import { FileText, Quote, X } from "lucide-react"
import { useMemo, useRef, useState } from "react"
import type { ChangeEntry } from "../../packages/revision/contracts.ts"
import type { EvaluationCitation } from "../../packages/revision/evaluation-contracts.ts"
import { buildCitation } from "../evaluation-draft.ts"

type CitationSource = Readonly<{
  key: string
  entryId: string
  title: string
  side: "before" | "after"
  field: "text" | "summary" | "storyTime" | "description"
  text: string
}>

const sideLabel = (side: CitationSource["side"]): string => side === "before" ? "Before" : "Proposal"
const fieldLabels: Readonly<Record<CitationSource["field"], string>> = { text: "Body", summary: "Summary", storyTime: "Story time", description: "Description" }

function textualField(value: ChangeEntry["before"], field: CitationSource["field"]): string | null {
  if (value === null || Array.isArray(value) || typeof value !== "object") return null
  switch (field) {
    case "text": return "text" in value && typeof value.text === "string" ? value.text : null
    case "summary": return "summary" in value && typeof value.summary === "string" ? value.summary : null
    case "storyTime": return "storyTime" in value && typeof value.storyTime === "string" ? value.storyTime : null
    case "description": return "description" in value && typeof value.description === "string" ? value.description : null
    default: { const exhaustive: never = field; return exhaustive }
  }
}

export function citationSources(entries: readonly ChangeEntry[]): readonly CitationSource[] {
  const fields = ["text", "summary", "storyTime", "description"] as const
  const sides = ["before", "after"] as const
  return entries.flatMap((entry) => sides.flatMap((side) => fields.flatMap((field) => {
    const text = textualField(entry[side], field)
    return text === null ? [] : [{ key: `${entry.id}:${side}:${field}`, entryId: entry.id, title: entry.title, side, field, text }]
  })))
}

export function EvaluationCitationPicker({ entries, citations, disabled, onChange }: Readonly<{ entries: readonly ChangeEntry[]; citations: readonly EvaluationCitation[]; disabled: boolean; onChange: (citations: EvaluationCitation[]) => void }>) {
  const sources = useMemo(() => citationSources(entries), [entries])
  const [sourceKey, setSourceKey] = useState(sources[0]?.key ?? "")
  const [error, setError] = useState<string | null>(null)
  const areaRef = useRef<HTMLTextAreaElement>(null)
  const source = sources.find((item) => item.key === sourceKey) ?? sources[0]
  const add = async (full: boolean) => {
    if (!source) return
    const start = full ? 0 : (areaRef.current?.selectionStart ?? 0)
    const end = full ? source.text.length : (areaRef.current?.selectionEnd ?? 0)
    if (start === end) { setError("Select a passage from the source to cite."); return }
    try {
      const citation = await buildCitation({ entryId: source.entryId, side: source.side, field: source.field, source: source.text, selectionStart: start, selectionEnd: end })
      onChange([...citations, citation]); setError(null)
    } catch (cause: unknown) { setError(cause instanceof Error ? cause.message : "Could not create the citation.") }
  }
  if (!source) return <p className="citation-empty"><FileText /> No before or proposal text is available to cite.</p>
  return <section className="citation-picker" aria-label="Exact source citation">
    <label className="field-label">Frozen source<select disabled={disabled} value={source.key} onChange={(event) => { setSourceKey(event.target.value); setError(null) }}>{sources.map((item) => <option key={item.key} value={item.key}>{item.title} · {sideLabel(item.side)} · {fieldLabels[item.field]}</option>)}</select></label>
    <label className="field-label">Complete source<textarea ref={areaRef} className="citation-source" readOnly value={source.text} /></label>
    <div className="citation-actions"><button className="button quiet compact" type="button" disabled={disabled} onClick={() => void add(false)}><Quote /> Quote selected passage</button><button className="button quiet compact" type="button" disabled={disabled} onClick={() => void add(true)}>Quote entire source</button></div>
    {error ? <p className="dialog-error" role="alert">{error}</p> : null}
    <div className="citation-list">{citations.map((citation, index) => <article key={`${citation.entryId}:${citation.side}:${citation.field}:${citation.startCp}:${index}`}>
      <div>
        <strong>{entries.find((entry) => entry.id === citation.entryId)?.title ?? citation.entryId}</strong>
        <small>{sideLabel(citation.side)} · {fieldLabels[citation.field]} · code points {citation.startCp}–{citation.endCp}</small>
        <blockquote>{citation.quote}</blockquote>
        <code title={citation.sourceHash}>{citation.sourceHash}</code>
      </div>
      <button
        className="icon-button"
        type="button"
        disabled={disabled}
        aria-label="Delete this citation"
        onClick={() => onChange(citations.filter((_, itemIndex) => itemIndex !== index))}
      ><X /></button>
    </article>)}</div>
  </section>
}
