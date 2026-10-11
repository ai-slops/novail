import { createHash, randomUUID } from "node:crypto";

import { canonicalJson } from "../packages/domain/canonical.mjs";
import { evaluationReportSchema } from "../packages/revision/evaluation-contracts.ts";
import { workspaceHash } from "../packages/revision/workspace.mjs";
import { appendEvent } from "./events.mjs";
import { DomainError } from "./errors.mjs";
import { buildEvaluationSources, validateEvaluationCriteria } from "./evaluation-evidence.mjs";
import { changeSetBindingIssues, mechanicalChecks } from "./evaluation-mechanical.mjs";

const reportPayload = ({ hash, ...report }) => report;
export const evaluationReportHash = (report) => createHash("sha256")
  .update(canonicalJson(reportPayload(report))).digest("hex");
const catalog = (state) => (state.evaluationReports ??= []);
const scopedReports = (state, changeSet) => catalog(state).filter((report) => report.projectId === state.project.id
  && report.branchId === state.currentBranchId && report.changeSetId === changeSet.id);
const fail = (code, message) => { throw new DomainError(code, message, 409); };

function assertCreationGuards(state, changeSet, input, latest) {
  if (changeSet.projectId !== state.project.id || changeSet.branchId !== state.currentBranchId) fail("BRANCH_MISMATCH", "Change set belongs to another branch.");
  const bindingIssues = changeSetBindingIssues(changeSet);
  if (bindingIssues.length > 0) fail(bindingIssues[0], "Change-set binding is invalid.");
  if (changeSet.hash !== input.expectedChangeSetHash) fail("CHANGESET_HASH_MISMATCH", "Change-set hash changed.");
  if (input.expectedHead !== state.head) fail("STALE_HEAD", "The branch head changed.");
  if (input.expectedWorkspaceHash !== workspaceHash(state)) fail("STALE_WORKSPACE", "The current workspace changed.");
  if (input.expectedLatestReportId !== (latest?.id ?? null)) fail("EVALUATION_REPORT_CAS_MISMATCH", "The latest evaluation report changed.");
}

function assertHistoryIntegrity(reports) {
  let previous = null;
  for (const report of reports) {
    const parsed = evaluationReportSchema.safeParse(report);
    const expectedParent = previous ? { id: previous.id, hash: previous.hash } : null;
    if (!parsed.success || evaluationReportHash(parsed.data) !== parsed.data.hash
      || canonicalJson(parsed.data.supersedes) !== canonicalJson(expectedParent)) {
      fail("EVALUATION_HISTORY_CORRUPT", "Stored evaluation history failed integrity validation.");
    }
    previous = parsed.data;
  }
}

export function createEvaluationReport(state, changeSet, input) {
  const reports = scopedReports(state, changeSet);
  assertHistoryIntegrity(reports);
  const latest = reports.at(-1) ?? null;
  assertCreationGuards(state, changeSet, input, latest);
  const checks = mechanicalChecks(changeSet);
  const sources = buildEvaluationSources(state, changeSet);
  const evaluated = validateEvaluationCriteria(changeSet, sources.requiredSources, input.criteria);
  const report = {
    schemaVersion: 1,
    id: `evaluation-${randomUUID()}`,
    revision: reports.length + 1,
    supersedes: latest ? { id: latest.id, hash: latest.hash } : null,
    projectId: state.project.id,
    branchId: state.currentBranchId,
    changeSetId: changeSet.id,
    changeSetHash: changeSet.hash,
    observedHead: state.head,
    observedWorkspaceHash: workspaceHash(state),
    author: { kind: "human", actor: "local-owner" },
    criteria: evaluated.criteria,
    mechanicalChecks: checks,
    humanVerdict: evaluated.humanVerdict,
    createdAt: new Date().toISOString(),
  };
  const stored = evaluationReportSchema.parse({ ...report, hash: evaluationReportHash(report) });
  catalog(state).push(stored);
  appendEvent(state, "evaluation_report.created", { changeSetId: changeSet.id, evaluationReportId: stored.id,
    revision: stored.revision, humanVerdict: stored.humanVerdict });
  return stored;
}

function projectStoredReport(state, changeSet, report, previous) {
  const parsed = evaluationReportSchema.safeParse(report);
  if (!parsed.success) return { valid: false, reportId: typeof report?.id === "string" ? report.id : null,
    current: false, evidenceValid: false, invalidReasons: ["REPORT_SCHEMA_INVALID"] };
  const envelopeReasons = [];
  if (evaluationReportHash(parsed.data) !== parsed.data.hash) envelopeReasons.push("REPORT_HASH_INVALID");
  const expectedParent = previous ? { id: previous.id, hash: previous.hash } : null;
  if (canonicalJson(parsed.data.supersedes) !== canonicalJson(expectedParent)) envelopeReasons.push("REPORT_CHAIN_INVALID");
  if (envelopeReasons.length) return { valid: false, reportId: parsed.data.id, current: false,
    evidenceValid: false, invalidReasons: envelopeReasons };
  const invalidReasons = changeSetBindingIssues(changeSet);
  let evidenceValid = true;
  try {
    const sources = buildEvaluationSources(state, changeSet);
    validateEvaluationCriteria(changeSet, sources.requiredSources, parsed.data.criteria);
  } catch (error) {
    if (error instanceof DomainError) {
      evidenceValid = false;
      invalidReasons.push("REPORT_EVIDENCE_INVALID");
    }
    else throw error;
  }
  if (parsed.data.changeSetHash !== changeSet.hash) invalidReasons.push("REPORT_CHANGESET_BINDING_MISMATCH");
  if (parsed.data.observedHead !== state.head) invalidReasons.push("REPORT_HEAD_NONCURRENT");
  if (parsed.data.observedWorkspaceHash !== workspaceHash(state)) invalidReasons.push("REPORT_WORKSPACE_NONCURRENT");
  const uniqueReasons = [...new Set(invalidReasons)];
  return { valid: true, report: parsed.data, current: evidenceValid && uniqueReasons.length === 0,
    evidenceValid, invalidReasons: uniqueReasons };
}

export function projectEvaluationHistory(state, changeSet) {
  const reports = scopedReports(state, changeSet);
  let previous = null;
  const history = reports.map((report) => {
    const projected = projectStoredReport(state, changeSet, report, previous);
    if (projected.valid) previous = projected.report;
    return projected;
  });
  return { latestReportId: reports.at(-1)?.id ?? null, history };
}
