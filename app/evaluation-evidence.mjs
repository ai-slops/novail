import { createHash } from "node:crypto";

import { evaluationCriterionSchema } from "../packages/revision/evaluation-contracts.ts";
import { validateSpan } from "../packages/domain/narrative.ts";
import { DomainError } from "./errors.mjs";

const unknownRationale = "Not yet evaluated by a human.";
const hashText = (text) => createHash("sha256").update(text).digest("hex");
const failEvidence = (message) => { throw new DomainError("EVIDENCE_INVALID", message, 422); };

function sourceRecord(feedbackId, feedback) {
  if (!feedback) return { key: `feedback:${feedbackId}`, kind: "feedback", feedbackId,
    sourceHash: null, text: null, available: false, warning: `Linked feedback is missing: ${feedbackId}` };
  return { key: `feedback:${feedbackId}`, kind: "feedback", feedbackId, sourceHash: hashText(feedback.text),
    text: feedback.text, available: true, warning: null };
}

function basisFor(source) {
  const span = { sourceHash: source.sourceHash, startCp: 0, endCp: Array.from(source.text).length, quote: source.text };
  return source.kind === "feedback" ? { kind: "feedback", feedbackId: source.feedbackId, ...span }
    : { kind: "change_set_reason", ...span };
}

export function buildEvaluationSources(state, changeSet) {
  const requiredSources = changeSet.feedbackIds.length > 0
    ? changeSet.feedbackIds.map((feedbackId) => sourceRecord(feedbackId,
      state.feedback.find(({ id }) => id === feedbackId)))
    : [{ key: "change_set_reason", kind: "change_set_reason", feedbackId: null,
      sourceHash: hashText(changeSet.reason), text: changeSet.reason, available: true, warning: null }];
  const defaultCriteria = requiredSources.filter(({ available }) => available).map((source, index) => ({
    id: `criterion-default-${index + 1}`,
    text: source.text,
    formulation: "verbatim_source",
    basisRefs: [basisFor(source)],
    verdict: "unknown",
    rationale: unknownRationale,
    citations: [],
  }));
  return { requiredSources, defaultCriteria };
}

function basisSource(requiredSources, basis) {
  return requiredSources.find((source) => source.kind === basis.kind
    && (basis.kind !== "feedback" || source.feedbackId === basis.feedbackId));
}

function validateBasis(requiredSources, basis) {
  const source = basisSource(requiredSources, basis);
  if (!source?.available || source.text === null || source.sourceHash !== basis.sourceHash
    || hashText(source.text) !== basis.sourceHash
    || !validateSpan({ text: source.text, startCp: basis.startCp, endCp: basis.endCp, quote: basis.quote }).valid) {
    failEvidence("Criterion basis does not match an immutable required source.");
  }
}

function citationText(changeSet, citation) {
  const entry = changeSet.entries.find(({ id }) => id === citation.entryId);
  const value = entry?.[citation.side];
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const text = value[citation.field];
  return typeof text === "string" ? text : null;
}

function validateCitation(changeSet, citation) {
  const text = citationText(changeSet, citation);
  if (text === null || hashText(text) !== citation.sourceHash
    || !validateSpan({ text, startCp: citation.startCp, endCp: citation.endCp, quote: citation.quote }).valid) {
    failEvidence("Citation does not match a frozen change entry value.");
  }
}

export function validateEvaluationCriteria(changeSet, requiredSources, inputCriteria) {
  const criteria = inputCriteria.map((criterion) => evaluationCriterionSchema.parse(criterion));
  for (const criterion of criteria) {
    for (const basis of criterion.basisRefs) validateBasis(requiredSources, basis);
    for (const citation of criterion.citations) validateCitation(changeSet, citation);
  }
  const represented = (source) => criteria.some(({ basisRefs }) => basisRefs.some((basis) => {
    const matched = basisSource([source], basis);
    return matched?.sourceHash === basis.sourceHash;
  }));
  const everyRequiredRepresented = requiredSources.every((source) => source.available && represented(source));
  const humanVerdict = criteria.some(({ verdict }) => verdict === "violated") ? "violated"
    : criteria.length > 0 && criteria.every(({ verdict }) => verdict === "fulfilled") && everyRequiredRepresented
      ? "fulfilled" : "unknown";
  return { criteria, humanVerdict };
}
