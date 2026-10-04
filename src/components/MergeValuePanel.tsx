import type { MergePreview, MergeResolution } from "../../packages/revision/contracts.ts"
import { dependenciesSchema, layoutSchema, mergeResolutionSchema, planValueSchema, sceneValueSchema } from "../../packages/revision/contracts.ts"

type MergeItem = MergePreview["items"][number]
export type CustomDraft = Readonly<{ primary: string; secondary: string }>
type CustomResult = Readonly<{ ok: true; resolution: MergeResolution }> | Readonly<{ ok: false; message: string }>

const prototypeOf = (item: MergeItem): unknown => item.source ?? item.target ?? (item.baseKnown ? item.base : null)

export function initialCustomDraft(item: MergeItem): CustomDraft {
  const prototype = prototypeOf(item)
  switch (item.kind) {
    case "scene": {
      const parsed = sceneValueSchema.safeParse(prototype)
      return { primary: parsed.success ? parsed.data.text : "", secondary: "" }
    }
    case "plan": {
      const parsed = planValueSchema.safeParse(prototype)
      return { primary: parsed.success ? parsed.data.title : "", secondary: parsed.success ? parsed.data.description : "" }
    }
    case "dependencies":
    case "layout": return { primary: JSON.stringify(prototype, null, 2), secondary: "" }
    default: return item.kind
  }
}

export function buildCustomResolution(item: MergeItem, draft: CustomDraft): CustomResult {
  const prototype = prototypeOf(item)
  switch (item.kind) {
    case "scene": {
      const parsed = sceneValueSchema.safeParse(prototype)
      if (!parsed.success) return { ok: false, message: `${item.title}: 보존할 장면 메타데이터가 없습니다.` }
      return { ok: true, resolution: mergeResolutionSchema.parse({ key: item.key, choice: "custom", change: { kind: "scene", artifactId: item.artifactId, after: { ...parsed.data, text: draft.primary } } }) }
    }
    case "plan": {
      const parsed = planValueSchema.safeParse(prototype)
      if (!parsed.success) return { ok: false, message: `${item.title}: 보존할 기획 메타데이터가 없습니다.` }
      return { ok: true, resolution: mergeResolutionSchema.parse({ key: item.key, choice: "custom", change: { kind: "plan", artifactId: item.artifactId, after: { ...parsed.data, title: draft.primary, description: draft.secondary } } }) }
    }
    case "dependencies": {
      try { return { ok: true, resolution: mergeResolutionSchema.parse({ key: item.key, choice: "custom", change: { kind: "dependencies", artifactId: "dependency-graph", after: dependenciesSchema.parse(JSON.parse(draft.primary)) } }) } } catch (cause: unknown) { return { ok: false, message: cause instanceof SyntaxError ? `${item.title}: JSON 형식이 올바르지 않습니다.` : `${item.title}: 의존 관계 값이 계약과 다릅니다.` } }
    }
    case "layout": {
      try { return { ok: true, resolution: mergeResolutionSchema.parse({ key: item.key, choice: "custom", change: { kind: "layout", artifactId: "reading-order", after: layoutSchema.parse(JSON.parse(draft.primary)) } }) } } catch (cause: unknown) { return { ok: false, message: cause instanceof SyntaxError ? `${item.title}: JSON 형식이 올바르지 않습니다.` : `${item.title}: 읽기 순서 값이 계약과 다릅니다.` } }
    }
    default: return item.kind
  }
}

export function MergeValuePanel({ label, item, value, unknownBase = false }: Readonly<{ label: string; item: MergeItem; value: unknown; unknownBase?: boolean }>) {
  return <section className="merge-value"><h4>{label}</h4>{unknownBase ? <p className="merge-value-unknown">공통 기준본을 확인할 수 없음</p> : <pre>{readableValue(item, value)}</pre>}</section>
}

function readableValue(item: MergeItem, value: unknown): string {
  if (value === null) return "(삭제됨)"
  switch (item.kind) {
    case "scene": {
      const parsed = sceneValueSchema.safeParse(value)
      return parsed.success ? `${parsed.data.chapter}장 · ${parsed.data.title}\n상태: ${parsed.data.status}\n시간: ${parsed.data.storyTime}\n등장인물: ${parsed.data.characters.join(" · ") || "없음"}\n\n${parsed.data.text}` : "장면 값을 읽을 수 없습니다."
    }
    case "plan": {
      const parsed = planValueSchema.safeParse(value)
      return parsed.success ? `${parsed.data.title}\n종류: ${parsed.data.kind} · 상태: ${parsed.data.status}\n\n${parsed.data.description}` : "기획 값을 읽을 수 없습니다."
    }
    case "dependencies":
    case "layout": return JSON.stringify(value, null, 2)
    default: return item.kind
  }
}

export function MergeCustomEditor({ item, draft, disabled, onChange }: Readonly<{ item: MergeItem; draft: CustomDraft; disabled: boolean; onChange: (draft: CustomDraft) => void }>) {
  switch (item.kind) {
    case "scene": return <label className="field-label">사용자 정의 장면 본문<textarea disabled={disabled} value={draft.primary} onChange={(event) => onChange({ ...draft, primary: event.target.value })} /></label>
    case "plan": return <div className="merge-custom-plan"><label className="field-label">기획 제목<input disabled={disabled} value={draft.primary} onChange={(event) => onChange({ ...draft, primary: event.target.value })} /></label><label className="field-label">기획 설명<textarea disabled={disabled} value={draft.secondary} onChange={(event) => onChange({ ...draft, secondary: event.target.value })} /></label></div>
    case "dependencies":
    case "layout": return <label className="field-label">고급 JSON 값<textarea disabled={disabled} value={draft.primary} onChange={(event) => onChange({ ...draft, primary: event.target.value })} /></label>
    default: return item.kind
  }
}
