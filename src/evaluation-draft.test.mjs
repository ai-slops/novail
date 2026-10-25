import { test } from "node:test"
import assert from "node:assert/strict"
import {
  buildCitation,
  duplicateCriterion,
  editCriterionText,
  evaluationDraftChanged,
  initialCriteria,
  splitCriterion,
  validateCriterion,
} from "./evaluation-draft.ts"

const basis = [{ kind: "feedback", feedbackId: "feedback-1", sourceHash: "a".repeat(64), startCp: 0, endCp: 4, quote: "원문 기준" }]
const criterion = { id: "criterion-1", text: "원문 기준", formulation: "verbatim_source", basisRefs: basis, verdict: "unknown", rationale: "아직 사람이 평가하지 않았습니다.", citations: [] }

test("editing a sourced criterion preserves basis and marks human refinement", () => {
  const edited = editCriterionText(criterion, "조금 더 구체적인 기준")
  assert.equal(edited.formulation, "human_refinement")
  assert.deepEqual(edited.basisRefs, basis)
})

test("duplicating and splitting a sourced criterion retain source basis", () => {
  const duplicate = duplicateCriterion(criterion, "criterion-copy")
  const split = splitCriterion(criterion, "첫 기준\n둘째 기준", ["criterion-a", "criterion-b"])
  assert.deepEqual(duplicate.basisRefs, basis)
  assert.equal(duplicate.formulation, "human_refinement")
  assert.deepEqual(split.map((item) => item.basisRefs), [basis, basis])
  assert.deepEqual(split.map((item) => item.text), ["첫 기준", "둘째 기준"])
})

test("exact citation uses untrimmed quote and Unicode code-point offsets", async () => {
  const source = "A😀 나비  "
  const citation = await buildCitation({ entryId: "entry-1", side: "after", field: "text", source, selectionStart: 1, selectionEnd: source.length })
  assert.equal(citation.quote, "😀 나비  ")
  assert.equal(citation.startCp, 1)
  assert.equal(citation.endCp, 7)
  assert.equal(citation.sourceHash, "1592bc40f3b6db939f87f33bf44a2a6bb715a21d406f6ee1f6b06ecfb7cfa625")
})

test("every verdict requires rationale while only known verdicts require citations", () => {
  assert.deepEqual(validateCriterion({ ...criterion, verdict: "fulfilled", rationale: "", citations: [] }), ["Enter the rationale for this judgment.", "Add a citation from the before or proposal text."])
  assert.deepEqual(validateCriterion({ ...criterion, rationale: "" }), ["Enter the rationale for this judgment."])
  assert.deepEqual(validateCriterion(criterion), [])
})

test("every verdict requires a criterion sentence", () => {
  const citation = { entryId: "entry-1", side: "after", field: "text", sourceHash: "b".repeat(64), startCp: 0, endCp: 1, quote: "근" }
  assert.deepEqual(validateCriterion({ ...criterion, text: "  ", verdict: "fulfilled", rationale: "사람의 판단", citations: [citation] }), ["Enter an evaluation criterion."])
})

test("latest valid report initializes a revision and corrupt entries are ignored", () => {
  const old = { ...criterion, id: "old", text: "old" }
  const latest = { ...criterion, id: "latest", text: "latest" }
  const history = [
    { valid: true, report: { criteria: [old] } },
    { valid: false, reportId: "broken", current: false, evidenceValid: false, invalidReasons: ["REPORT_HASH_INVALID"] },
    { valid: true, report: { criteria: [latest] } },
  ]
  assert.deepEqual(initialCriteria(history, [criterion]), [latest])
  assert.deepEqual(initialCriteria(history.slice(0, 2), [criterion]), [old])
  assert.deepEqual(initialCriteria([], [criterion]), [criterion])
})

test("evaluation draft is dirty only when criterion content differs from its loaded baseline", () => {
  const unchangedCopy = [{ ...criterion, basisRefs: basis.map((item) => ({ ...item })) }]
  assert.equal(evaluationDraftChanged([criterion], unchangedCopy), false)
  assert.equal(evaluationDraftChanged([criterion], [{ ...criterion, rationale: "새 판단 근거" }]), true)
  assert.equal(evaluationDraftChanged([criterion], [...unchangedCopy, { ...criterion, id: "criterion-2" }]), true)
})
