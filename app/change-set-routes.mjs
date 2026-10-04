import { z } from "zod";

import {
  changeSetSchema, commitChangeSetSchema, deriveSchema, manualChangeSetSchema, revisionContextSchema,
} from "../packages/revision/contracts.ts";
import {
  commitChangeSet, createChangeSet, deriveChangeSet, getChangeSet, promoteCandidate, rejectChangeSet, resolveFeedback,
} from "../packages/revision/changesets.mjs";
import { canonicalWorkspace, workspaceHash } from "../packages/revision/workspace.mjs";
import { assertReadScope, branchHeader } from "./branch-scope.mjs";
import { DomainError } from "./errors.mjs";

const rejectSchema = z.strictObject({ decision: z.literal("reject") });
const promoteSchema = z.strictObject({ expectedHead: z.string().min(1).max(200) });
const feedbackResolutionSchema = z.strictObject({ expectedHead: z.string().min(1).max(200),
  decision: z.enum(["close", "defer", "reopen"]), note: z.string().trim().min(1).max(20_000) });

async function body(context, schema) {
  let input;
  try {
    input = await context.req.json();
  } catch {
    throw new DomainError("SCHEMA_INVALID", "Request body must be valid JSON.", 400);
  }
  return schema.parse(input);
}

const response = (changeSet) => changeSetSchema.parse(changeSet);

export function mountRevisionRoutes(app, { store, command }) {
  app.get("/api/revision-context", async (context) => {
    const state = await store.read();
    assertReadScope(state, context.req.header(branchHeader));
    const workspace = canonicalWorkspace(state);
    return context.json(revisionContextSchema.parse({ projectId: state.project.id, branchId: state.currentBranchId,
      baseSnapshotId: state.head, workspaceHash: workspaceHash(workspace), workspace }));
  });
  app.get("/api/change-sets/:id", async (context) => {
    const state = await store.read();
    assertReadScope(state, context.req.header(branchHeader));
    return context.json(response(getChangeSet(state, context.req.param("id"))));
  });
  app.post("/api/change-sets", async (context) => {
    const input = await body(context, manualChangeSetSchema);
    return command(context, { body: input, status: 201 }, (state) => response(createChangeSet(state, {
      kind: "manual", reason: input.reason, changes: input.changes, baseSnapshotId: input.baseSnapshotId,
      baseWorkspaceHash: input.baseWorkspaceHash, feedbackIds: input.feedbackIds, runId: null, candidateId: null,
      parentChangeSetId: null, atomic: input.atomic, merge: null,
    })));
  });
  app.post("/api/change-sets/:id/derive", async (context) => {
    const input = await body(context, deriveSchema);
    return command(context, { body: input, status: 201 }, (state) => response(deriveChangeSet(state, context.req.param("id"), input)));
  });
  app.post("/api/change-sets/:id/commit", async (context) => {
    const input = await body(context, commitChangeSetSchema);
    return command(context, { body: input, status: 200 }, (state) => {
      const result = commitChangeSet(state, context.req.param("id"), input);
      return { ...result, changeSet: response(result.changeSet) };
    });
  });
  app.post("/api/change-sets/:id/reject", async (context) => {
    const input = await body(context, rejectSchema);
    return command(context, { body: input, status: 200 }, (state) => response(rejectChangeSet(state, context.req.param("id"))));
  });
  app.post("/api/candidates/:id/promote", async (context) => {
    const input = await body(context, promoteSchema);
    return command(context, { body: input, status: 201 }, (state) => response(promoteCandidate(state, context.req.param("id"), input)));
  });
  app.post("/api/feedback/:id/resolve", async (context) => {
    const input = await body(context, feedbackResolutionSchema);
    return command(context, { body: input, status: 200 }, (state) => resolveFeedback(state, context.req.param("id"), input));
  });
}
