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

const sideLabel = (side: CitationSource["side"]): string => side === "before" ? "이전" : "제안"
const fieldLabels: Readonly<Record<CitationSource["field"], string>> = { text: "본문", summary: "요약", storyTime: "이야기 시간", description: "설명" }

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
    if (start === end) { setError("인용할 구절을 원문에서 선택하세요."); return }
    try {
      const citation = await buildCitation({ entryId: source.entryId, side: source.side, field: source.field, source: source.text, selectionStart: start, selectionEnd: end })
      onChange([...citations, citation]); setError(null)
    } catch (cause: unknown) { setError(cause instanceof Error ? cause.message : "인용을 만들지 못했습니다.") }
  }
  if (!source) return <p className="citation-empty"><FileText /> 인용할 수 있는 이전·제안 텍스트가 없습니다.</p>
  return <section className="citation-picker" aria-label="정확한 원문 인용">
    <label className="field-label">고정된 원문<select disabled={disabled} value={source.key} onChange={(event) => { setSourceKey(event.target.value); setError(null) }}>{sources.map((item) => <option key={item.key} value={item.key}>{item.title} · {sideLabel(item.side)} · {fieldLabels[item.field]}</option>)}</select></label>
    <label className="field-label">전체 원문<textarea ref={areaRef} className="citation-source" readOnly value={source.text} /></label>
    <div className="citation-actions"><button className="button quiet compact" type="button" disabled={disabled} onClick={() => void add(false)}><Quote /> 선택 구절 인용</button><button className="button quiet compact" type="button" disabled={disabled} onClick={() => void add(true)}>전체 원문 인용</button></div>
    {error ? <p className="dialog-error" role="alert">{error}</p> : null}
    <div className="citation-list">{citations.map((citation, index) => <article key={`${citation.entryId}:${citation.side}:${citation.field}:${citation.startCp}:${index}`}><div><strong>{entries.find((entry) => entry.id === citation.entryId)?.title ?? citation.entryId}</strong><small>{sideLabel(citation.side)} · {fieldLabels[citation.field]} · 코드포인트 {citation.startCp}–{citation.endCp}</small><blockquote>{citation.quote}</blockquote><code title={citation.sourceHash}>{citation.sourceHash}</code></div><button className="icon-button" type="button" disabled={disabled} aria-label="이 인용 삭제" onClick={() => onChange(citations.filter((_, itemIndex) => itemIndex !== index))}><X /></button></article>)}</div>
  </section>
}
