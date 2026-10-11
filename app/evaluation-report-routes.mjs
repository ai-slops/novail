import {
  evaluationReportRequestSchema,
  evaluationReportSchema,
  evaluationReportsResponseSchema,
} from "../packages/revision/evaluation-contracts.ts";
import { getChangeSet } from "../packages/revision/changesets.mjs";
import { workspaceHash } from "../packages/revision/workspace.mjs";
import { assertReadScope, branchHeader } from "./branch-scope.mjs";
import { DomainError } from "./errors.mjs";
import { buildEvaluationSources } from "./evaluation-evidence.mjs";
import { changeSetBindingIssues, mechanicalChecks } from "./evaluation-mechanical.mjs";
import { createEvaluationReport, projectEvaluationHistory } from "./evaluation-reports.mjs";

async function body(context) {
  let input;
  try {
    input = await context.req.json();
  } catch {
    throw new DomainError("SCHEMA_INVALID", "Request body must be valid JSON.", 400);
  }
  return evaluationReportRequestSchema.parse(input);
}

function invalidMechanicalPreview(error) {
  const code = error instanceof DomainError ? error.code : "EVALUATION_BINDING_INVALID";
  return [
    { id: "integrity", verdict: "fail", code, message: "The change-set binding is invalid.", keys: [] },
    { id: "workspace_schema", verdict: "unknown", code: "CHECK_SKIPPED_INTEGRITY_FAILURE", message: "Workspace validation was skipped.", keys: [] },
    { id: "protected_content", verdict: "unknown", code: "CHECK_SKIPPED_INTEGRITY_FAILURE", message: "Protection validation was skipped.", keys: [] },
    { id: "temporal", verdict: "unknown", code: "NO_STRUCTURED_TEMPORAL_CONSTRAINTS", message: "No structured temporal constraints were supplied.", keys: [] },
  ];
}

function projection(state, changeSet) {
  const currentWorkspaceHash = workspaceHash(state);
  const staleReasons = [];
  if (changeSet.baseSnapshotId !== state.head) staleReasons.push("STALE_HEAD");
  if (changeSet.baseWorkspaceHash !== currentWorkspaceHash) staleReasons.push("STALE_WORKSPACE");
  const bindingIssues = changeSetBindingIssues(changeSet);
  let bindingValid = bindingIssues.length === 0;
  let preview;
  try {
    preview = bindingValid ? mechanicalChecks(changeSet)
      : invalidMechanicalPreview(new DomainError(bindingIssues[0] ?? "EVALUATION_BINDING_INVALID", "Invalid change-set binding."));
  } catch (error) {
    bindingValid = false;
    preview = invalidMechanicalPreview(error);
  }
  const sources = buildEvaluationSources(state, changeSet);
  const history = projectEvaluationHistory(state, changeSet);
  const historyValid = history.history.every(({ valid }) => valid);
  return evaluationReportsResponseSchema.parse({
    binding: {
      projectId: state.project.id,
      branchId: state.currentBranchId,
      changeSetId: changeSet.id,
      changeSetHash: changeSet.hash,
      changeSetStatus: changeSet.status,
      bindingValid,
      proposalBaseCurrent: staleReasons.length === 0,
      actionable: bindingValid && historyValid,
      staleReasons,
      observedHead: changeSet.baseSnapshotId,
      currentHead: state.head,
      observedWorkspaceHash: changeSet.baseWorkspaceHash,
      currentWorkspaceHash,
    },
    requiredSources: sources.requiredSources,
    defaultCriteria: sources.defaultCriteria,
    mechanicalPreview: preview,
    ...history,
  });
}

export function mountEvaluationReportRoutes(app, { store, command }) {
  app.get("/api/change-sets/:id/evaluation-reports", async (context) => {
    const state = await store.read();
    assertReadScope(state, context.req.header(branchHeader));
    return context.json(projection(state, getChangeSet(state, context.req.param("id"))));
  });
  app.post("/api/change-sets/:id/evaluation-reports", async (context) => {
    const input = await body(context);
    return command(context, { body: input, status: 201 }, (state) => evaluationReportSchema.parse(
      createEvaluationReport(state, getChangeSet(state, context.req.param("id")), input),
    ));
  });
}
