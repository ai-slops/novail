import assert from "node:assert/strict";
import test from "node:test";

import {
  evaluationCriterionSchema,
  evaluationReportSchema,
  evaluationReportRequestSchema,
} from "../packages/revision/evaluation-contracts.ts";

const hash = "a".repeat(64);
const feedbackBasis = {
  kind: "feedback",
  feedbackId: "feedback-1",
  sourceHash: hash,
  startCp: 0,
  endCp: 2,
  quote: "😀가",
};
const citation = {
  entryId: "change-1",
  side: "after",
  field: "text",
  sourceHash: hash,
  startCp: 0,
  endCp: 2,
  quote: "😀가",
};

test("Given exact astral-Unicode evidence, when a known criterion is parsed, then the strict contract accepts it", () => {
  const parsed = evaluationCriterionSchema.parse({
    id: "criterion-1",
    text: "😀가",
    formulation: "verbatim_source",
    basisRefs: [feedbackBasis],
    verdict: "fulfilled",
    rationale: "변경 결과에서 요구사항을 확인했습니다.",
    citations: [citation],
  });

  assert.equal(parsed.text, "😀가");
});

test("Given a known judgment without evidence, when a criterion is parsed, then the contract rejects it", () => {
  const result = evaluationCriterionSchema.safeParse({
    id: "criterion-1",
    text: "Requirement",
    formulation: "human_authored",
    basisRefs: [],
    verdict: "violated",
    rationale: "Not present.",
    citations: [],
  });

  assert.equal(result.success, false);
});

test("Given malformed formulation provenance, when criteria are parsed, then exact basis rules reject it", () => {
  const authoredWithBasis = evaluationCriterionSchema.safeParse({
    id: "criterion-1",
    text: "Requirement",
    formulation: "human_authored",
    basisRefs: [feedbackBasis],
    verdict: "unknown",
    rationale: "아직 사람이 평가하지 않았습니다.",
    citations: [],
  });
  const mismatchedVerbatim = evaluationCriterionSchema.safeParse({
    id: "criterion-2",
    text: "different",
    formulation: "verbatim_source",
    basisRefs: [feedbackBasis],
    verdict: "unknown",
    rationale: "아직 사람이 평가하지 않았습니다.",
    citations: [],
  });

  assert.equal(authoredWithBasis.success, false);
  assert.equal(mismatchedVerbatim.success, false);
});

test("Given unknown properties or nullable evidence, when report boundaries parse, then strict schemas reject them", () => {
  const request = evaluationReportRequestSchema.safeParse({
    expectedChangeSetHash: hash,
    expectedHead: "snapshot-1",
    expectedWorkspaceHash: hash,
    expectedLatestReportId: null,
    criteria: [],
    unexpected: true,
  });
  const report = evaluationReportSchema.safeParse({ citations: null });

  assert.equal(request.success, false);
  assert.equal(report.success, false);
});

test("Given meaningful evidence with edge whitespace, when parsed, then exact source bytes are preserved while whitespace-only evidence is rejected", () => {
  const exact = " \n😀가\t";
  const parsed = evaluationCriterionSchema.parse({
    id: "criterion-whitespace",
    text: exact,
    formulation: "verbatim_source",
    basisRefs: [{ ...feedbackBasis, endCp: Array.from(exact).length, quote: exact }],
    verdict: "unknown",
    rationale: "아직 사람이 평가하지 않았습니다.",
    citations: [],
  });
  const meaningless = evaluationCriterionSchema.safeParse({
    id: "criterion-empty",
    text: " \n\t",
    formulation: "verbatim_source",
    basisRefs: [{ ...feedbackBasis, endCp: 3, quote: " \n\t" }],
    verdict: "unknown",
    rationale: "아직 사람이 평가하지 않았습니다.",
    citations: [],
  });

  assert.equal(parsed.text, exact);
  assert.equal(parsed.basisRefs[0].quote, exact);
  assert.equal(meaningless.success, false);
});

test("Given duplicate criterion IDs, when a report request is parsed, then ambiguous criteria are rejected", () => {
  const criterion = {
    id: "criterion-duplicate",
    text: "Human criterion",
    formulation: "human_authored",
    basisRefs: [],
    verdict: "unknown",
    rationale: "아직 사람이 평가하지 않았습니다.",
    citations: [],
  };
  const result = evaluationReportRequestSchema.safeParse({
    expectedChangeSetHash: hash,
    expectedHead: "snapshot-1",
    expectedWorkspaceHash: hash,
    expectedLatestReportId: null,
    criteria: [criterion, criterion],
  });

  assert.equal(result.success, false);
});

test("Given no criteria, when a creation request is parsed, then the request boundary rejects it", () => {
  const result = evaluationReportRequestSchema.safeParse({
    expectedChangeSetHash: hash,
    expectedHead: "snapshot-1",
    expectedWorkspaceHash: hash,
    expectedLatestReportId: null,
    criteria: [],
  });

  assert.equal(result.success, false);
});
