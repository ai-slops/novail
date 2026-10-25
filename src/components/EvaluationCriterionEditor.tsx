import { CopyPlus, Scissors, Trash2 } from "lucide-react"
import type { ChangeEntry } from "../../packages/revision/contracts.ts"
import type { EvaluationCriterion } from "../../packages/revision/evaluation-contracts.ts"
import { duplicateCriterion, editCriterionText, formulationLabel, splitCriterion, validateCriterion } from "../evaluation-draft.ts"
import { EvaluationCitationPicker } from "./EvaluationCitationPicker.tsx"

type CriterionActions = Readonly<{
  change: (criterion: EvaluationCriterion) => void
  remove: () => void
  duplicate: (criterion: EvaluationCriterion) => void
  split: (criteria: readonly EvaluationCriterion[]) => void
}>

export function EvaluationCriterionEditor({ criterion, entries, disabled, actions }: Readonly<{ criterion: EvaluationCriterion; entries: readonly ChangeEntry[]; disabled: boolean; actions: CriterionActions }>) {
  const errors = validateCriterion(criterion)
  const split = () => {
    const text = window.prompt("Enter one evaluation criterion per line.", criterion.text)
    if (!text) return
    const count = text.split("\n").map((part) => part.trim()).filter(Boolean).length
    actions.split(splitCriterion(criterion, text, Array.from({ length: count }, () => crypto.randomUUID())))
  }
  return <fieldset className="evaluation-criterion" disabled={disabled}>
    <legend>Evaluation criterion</legend>
    <header>
      <span className={`formulation ${criterion.formulation}`}>{formulationLabel(criterion.formulation)}</span>
      <div>
        <button className="icon-button" type="button" onClick={() => actions.duplicate(duplicateCriterion(criterion, crypto.randomUUID()))} aria-label="Duplicate and refine this criterion"><CopyPlus /></button>
        <button className="icon-button" type="button" onClick={split} aria-label="Split this criterion"><Scissors /></button>
        <button className="icon-button" type="button" onClick={actions.remove} aria-label="Delete this criterion"><Trash2 /></button>
      </div>
    </header>
    <div className="criterion-grid"><div className="criterion-form"><label className="field-label">Criterion text<textarea value={criterion.text} onChange={(event) => actions.change(editCriterionText(criterion, event.target.value))} /></label><label className="field-label">Human rationale<textarea value={criterion.rationale} onChange={(event) => actions.change({ ...criterion, rationale: event.target.value })} /></label></div>
      <fieldset className="verdict-options"><legend>Human evaluation</legend>{(["fulfilled", "violated", "unknown"] as const).map((verdict) => <label key={verdict}><input type="radio" name={`verdict-${criterion.id}`} checked={criterion.verdict === verdict} onChange={() => actions.change({ ...criterion, verdict })} /><span>{verdict === "fulfilled" ? "Fulfilled" : verdict === "violated" ? "Violated" : "Unknown"}</span></label>)}</fieldset></div>
    <EvaluationCitationPicker entries={entries} citations={criterion.citations} disabled={disabled} onChange={(citations) => actions.change({ ...criterion, citations: [...citations] })} />
    {errors.length > 0 ? <ul className="criterion-errors" role="alert">{errors.map((error) => <li key={error}>{error}</li>)}</ul> : null}
  </fieldset>
}
