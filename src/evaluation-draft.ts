import { evaluationCitationSchema } from "../packages/revision/evaluation-contracts.ts"
import type { EvaluationCitation, EvaluationCriterion } from "../packages/revision/evaluation-contracts.ts"

type CitationSelection = Readonly<{
  entryId: string
  side: "before" | "after"
  field: "text" | "summary" | "storyTime" | "description"
  source: string
  selectionStart: number
  selectionEnd: number
}>

type CriterionHistory = Readonly<{
  valid: boolean
  report?: Readonly<{ criteria: readonly EvaluationCriterion[] }>
}>

class CitationBuildError extends Error {
  readonly name = "CitationBuildError"
  constructor() { super("Could not record the selected citation range.") }
}

export function editCriterionText(criterion: EvaluationCriterion, text: string): EvaluationCriterion {
  const formulation = criterion.basisRefs.length > 0 ? "human_refinement" : "human_authored"
  return { ...criterion, text, formulation }
}

export function duplicateCriterion(criterion: EvaluationCriterion, id: string): EvaluationCriterion {
  return { ...criterion, id, formulation: criterion.basisRefs.length > 0 ? "human_refinement" : "human_authored" }
}

export function splitCriterion(criterion: EvaluationCriterion, text: string, ids: readonly string[]): readonly EvaluationCriterion[] {
  const parts = text.split("\n").map((part) => part.trim()).filter(Boolean)
  return parts.flatMap((part, index) => {
    const id = ids[index]
    return id === undefined ? [] : [{ ...criterion, id, text: part, formulation: criterion.basisRefs.length > 0 ? "human_refinement" : "human_authored" }]
  })
}

export async function buildCitation(selection: CitationSelection): Promise<EvaluationCitation> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(selection.source))
  const sourceHash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")
  const startCp = Array.from(selection.source.slice(0, selection.selectionStart)).length
  const endCp = startCp + Array.from(selection.source.slice(selection.selectionStart, selection.selectionEnd)).length
  const citation = {
    entryId: selection.entryId,
    side: selection.side,
    field: selection.field,
    sourceHash,
    startCp,
    endCp,
    quote: selection.source.slice(selection.selectionStart, selection.selectionEnd),
  } satisfies EvaluationCitation
  if (!evaluationCitationSchema.safeParse(citation).success) throw new CitationBuildError()
  return citation
}

export function validateCriterion(criterion: EvaluationCriterion): readonly string[] {
  const errors: string[] = []
  if (!criterion.text.trim()) errors.push("Enter an evaluation criterion.")
  if (!criterion.rationale.trim()) errors.push("Enter the rationale for this judgment.")
  if (criterion.verdict !== "unknown" && criterion.citations.length === 0) errors.push("Add a citation from the before or proposal text.")
  return errors
}

export function initialCriteria(history: readonly CriterionHistory[], defaults: readonly EvaluationCriterion[]): readonly EvaluationCriterion[] {
  const valid = history.filter((item) => item.valid && item.report !== undefined).at(-1)
  return valid?.report?.criteria ?? defaults
}

export function evaluationDraftChanged(baseline: readonly EvaluationCriterion[], current: readonly EvaluationCriterion[]): boolean {
  return JSON.stringify(baseline) !== JSON.stringify(current)
}

export function formulationLabel(formulation: EvaluationCriterion["formulation"]): string {
  switch (formulation) {
    case "verbatim_source": return "Verbatim source"
    case "human_refinement": return "Human-refined criterion"
    case "human_authored": return "Human-authored criterion"
    default: { const exhaustive: never = formulation; return exhaustive }
  }
}
