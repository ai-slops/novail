import { createHash } from "node:crypto";

import { canonicalJson } from "../domain/canonical.mjs";

export function immutablePayload(changeSet) {
  return {
    id: changeSet.id, projectId: changeSet.projectId, branchId: changeSet.branchId,
    schemaVersion: changeSet.schemaVersion, policyVersion: changeSet.policyVersion, kind: changeSet.kind, reason: changeSet.reason,
    baseSnapshotId: changeSet.baseSnapshotId, baseWorkspaceHash: changeSet.baseWorkspaceHash,
    baseContextVersion: changeSet.baseContextVersion, entries: changeSet.entries, bundles: changeSet.bundles,
    impact: changeSet.impact, issues: changeSet.issues, requiredReviewKeys: changeSet.requiredReviewKeys,
    feedbackIds: changeSet.feedbackIds, runId: changeSet.runId,
    candidateId: changeSet.candidateId, parentChangeSetId: changeSet.parentChangeSetId,
    parentChangeSetHash: changeSet.parentChangeSetHash, parentChangeIds: changeSet.parentChangeIds, merge: changeSet.merge,
  };
}

export const changeSetHash = (changeSet) => createHash("sha256")
  .update(canonicalJson(immutablePayload(changeSet))).digest("hex");
