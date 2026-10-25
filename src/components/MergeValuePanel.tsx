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
      if (!parsed.success) return { ok: false, message: `${item.title}: No scene metadata is available to preserve.` }
      return { ok: true, resolution: mergeResolutionSchema.parse({ key: item.key, choice: "custom", change: { kind: "scene", artifactId: item.artifactId, after: { ...parsed.data, text: draft.primary } } }) }
    }
    case "plan": {
      const parsed = planValueSchema.safeParse(prototype)
      if (!parsed.success) return { ok: false, message: `${item.title}: No plan metadata is available to preserve.` }
      return { ok: true, resolution: mergeResolutionSchema.parse({ key: item.key, choice: "custom", change: { kind: "plan", artifactId: item.artifactId, after: { ...parsed.data, title: draft.primary, description: draft.secondary } } }) }
    }
    case "dependencies": {
      try { return { ok: true, resolution: mergeResolutionSchema.parse({ key: item.key, choice: "custom", change: { kind: "dependencies", artifactId: "dependency-graph", after: dependenciesSchema.parse(JSON.parse(draft.primary)) } }) } } catch (cause: unknown) { return { ok: false, message: cause instanceof SyntaxError ? `${item.title}: Invalid JSON.` : `${item.title}: Dependency values do not match the contract.` } }
    }
    case "layout": {
      try { return { ok: true, resolution: mergeResolutionSchema.parse({ key: item.key, choice: "custom", change: { kind: "layout", artifactId: "reading-order", after: layoutSchema.parse(JSON.parse(draft.primary)) } }) } } catch (cause: unknown) { return { ok: false, message: cause instanceof SyntaxError ? `${item.title}: Invalid JSON.` : `${item.title}: Reading-order values do not match the contract.` } }
    }
    default: return item.kind
  }
}

export function MergeValuePanel({ label, item, value, unknownBase = false }: Readonly<{ label: string; item: MergeItem; value: unknown; unknownBase?: boolean }>) {
  return <section className="merge-value"><h4>{label}</h4>{unknownBase ? <p className="merge-value-unknown">Common base unavailable</p> : <pre>{readableValue(item, value)}</pre>}</section>
}

function readableValue(item: MergeItem, value: unknown): string {
  if (value === null) return "(Deleted)"
  switch (item.kind) {
    case "scene": {
      const parsed = sceneValueSchema.safeParse(value)
      return parsed.success ? `${parsed.data.chapter} · ${parsed.data.title}\nStatus: ${parsed.data.status}\nTime: ${parsed.data.storyTime}\nCharacters: ${parsed.data.characters.join(" · ") || "None"}\n\n${parsed.data.text}` : "Could not read the scene value."
    }
    case "plan": {
      const parsed = planValueSchema.safeParse(value)
      return parsed.success ? `${parsed.data.title}\nKind: ${parsed.data.kind} · Status: ${parsed.data.status}\n\n${parsed.data.description}` : "Could not read the plan value."
    }
    case "dependencies":
    case "layout": return JSON.stringify(value, null, 2)
    default: return item.kind
  }
}

export function MergeCustomEditor({ item, draft, disabled, onChange }: Readonly<{ item: MergeItem; draft: CustomDraft; disabled: boolean; onChange: (draft: CustomDraft) => void }>) {
  switch (item.kind) {
    case "scene": return <label className="field-label">Custom scene body<textarea disabled={disabled} value={draft.primary} onChange={(event) => onChange({ ...draft, primary: event.target.value })} /></label>
    case "plan": return <div className="merge-custom-plan"><label className="field-label">Plan title<input disabled={disabled} value={draft.primary} onChange={(event) => onChange({ ...draft, primary: event.target.value })} /></label><label className="field-label">Plan description<textarea disabled={disabled} value={draft.secondary} onChange={(event) => onChange({ ...draft, secondary: event.target.value })} /></label></div>
    case "dependencies":
    case "layout": return <label className="field-label">Advanced JSON value<textarea disabled={disabled} value={draft.primary} onChange={(event) => onChange({ ...draft, primary: event.target.value })} /></label>
    default: return item.kind
  }
}
