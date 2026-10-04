import { randomUUID } from "node:crypto";

import { DomainError } from "../../app/errors.mjs";
import { appendEvent } from "../../app/events.mjs";
import { assertIdleWorkspace, assertRecordBranch } from "../../app/branch-state.mjs";
import { advanceSnapshot } from "../../app/snapshots.mjs";
import { candidateHash } from "../../app/candidate-hash.mjs";
import { makeEntries, validateWorkspace } from "./change-entries.mjs";
import { changeSetHash } from "./change-set-hash.mjs";
import { buildBundles, computeImpact } from "./impact.mjs";
import { canonicalWorkspace, installWorkspace, projectEntries, workspaceFromSnapshot, workspaceHash } from "./workspace.mjs";

const fail = (code, message, status = 409) => { throw new DomainError(code, message, status); };
const ensureCatalog = (state) => (state.changeSets ??= []);

function baseFor(state, input) {
  const currentHash = workspaceHash(state);
  const current = input.baseSnapshotId === state.head && input.baseWorkspaceHash === currentHash;
  if (input.kind === "manual" && !current) fail(input.baseSnapshotId !== state.head ? "STALE_HEAD" : "STALE_WORKSPACE", "The manual proposal base is stale.");
  if (current) return { workspace: canonicalWorkspace(state), stale: false };
  if (input.kind === "repair" && input.baseWorkspace && workspaceHash(input.baseWorkspace) === input.baseWorkspaceHash) {
    return { workspace: canonicalWorkspace(input.baseWorkspace), stale: true };
  }
  if (input.baseWorkspace && workspaceHash(input.baseWorkspace) === input.baseWorkspaceHash) return { workspace: canonicalWorkspace(input.baseWorkspace), stale: true };
  fail("BASE_WORKSPACE_UNKNOWN", "The exact base workspace is unavailable.");
}

function blockedReasons(state, changeSet) {
  const reasons = [];
  if (changeSet.status !== "pending") reasons.push("STATUS_CLOSED");
  if (changeSet.baseSnapshotId !== state.head) reasons.push("STALE_HEAD");
  if (changeSet.baseWorkspaceHash !== workspaceHash(state)) reasons.push("STALE_WORKSPACE");
  if (changeSet.impact.incomplete) reasons.push("IMPACT_INCOMPLETE");
  if (changeSet.issues.length) reasons.push("VALIDATION_ISSUES");
  const run = changeSet.runId ? state.runs.find(({ id }) => id === changeSet.runId) : null;
  if (run?.state === "cancelled" || run?.cancellationRequested) reasons.push("RUN_CANCELLED");
  if (state.runs.some(({ state: runState }) => ["queued", "running", "paused"].includes(runState))) reasons.push("RUN_ACTIVE");
  if (changeSet.merge && !mergeBindingCurrent(state, changeSet)) reasons.push("STALE_MERGE_SOURCE");
  return reasons;
}

function refresh(state, changeSet) {
  const reasons = blockedReasons(state, changeSet);
  let status = changeSet.status;
  if (status === "pending" && reasons.includes("RUN_CANCELLED")) status = "cancelled";
  else if (status === "pending" && ["STALE_HEAD", "STALE_WORKSPACE", "STALE_MERGE_SOURCE"].some((reason) => reasons.includes(reason))) status = "stale_candidate";
  return { ...structuredClone(changeSet), status, canCommit: reasons.length === 0, blockedReasons: reasons };
}

export function createChangeSet(state, input) {
  const { workspace: base, stale } = baseFor(state, input);
  const entries = makeEntries(base, input.changes);
  const issues = [];
  let projected = projectEntries(base, entries);
  if (!entries.length) {
    if (input.kind !== "repair" && input.kind !== "merge") fail("NO_CHANGES", "The proposal contains no semantic changes.", 422);
    if (input.kind === "repair") issues.push({ code: "NO_CHANGES", message: "Generated output contains no semantic changes.", keys: [] });
  }
  try {
    projected = validateWorkspace(base, entries, input.merge?.protectionRequirements);
  } catch (error) {
    if (input.kind === "repair" && error?.code) issues.push({ code: error.code, message: error.message, keys: error.keys ?? [] });
    else if (error?.code) fail(error.code, error.message, error.status ?? 422);
    else throw error;
  }
  let impact = computeImpact(base, projected, entries);
  if (issues.length) impact = { ...impact, incomplete: true,
    unexamined: [...new Set([...impact.unexamined, "invalid-projection"])],
    warnings: [...impact.warnings, "Generated output failed workspace validation"] };
  const bundles = buildBundles(base, projected, entries, input.atomic || input.kind === "merge");
  const requiredReviewKeys = impact.reviewSet.filter(({ changed }) => !changed).map(({ key }) => key).sort();
  const changeSet = {
    id: `changeset-${randomUUID()}`, projectId: state.project.id, branchId: state.currentBranchId,
    schemaVersion: 2, policyVersion: 2, kind: input.kind, reason: input.reason,
    baseSnapshotId: input.baseSnapshotId, baseWorkspaceHash: input.baseWorkspaceHash,
    baseContextVersion: input.baseContextVersion ?? state.contextVersion ?? 0, entries, bundles, impact, issues,
    feedbackIds: [...input.feedbackIds], runId: input.runId, candidateId: input.candidateId,
    parentChangeSetId: input.parentChangeSetId, parentChangeSetHash: input.parentChangeSetHash ?? null,
    parentChangeIds: [...(input.parentChangeIds ?? [])], merge: input.merge, createdAt: new Date().toISOString(),
    status: "pending", canCommit: !stale && !impact.incomplete && !issues.length,
    blockedReasons: [], requiredReviewKeys,
    _baseWorkspace: base,
  };
  changeSet.hash = changeSetHash(changeSet);
  ensureCatalog(state).push(changeSet);
  for (const feedback of state.feedback.filter(({ id }) => changeSet.feedbackIds.includes(id))) {
    if (feedback.state === "open") feedback.state = "awaiting_decision";
  }
  appendEvent(state, "changeset.created", { changeSetId: changeSet.id, kind: changeSet.kind, stale });
  return refresh(state, changeSet);
}

export function getChangeSet(state, id) {
  const changeSet = ensureCatalog(state).find((item) => item.id === id && item.branchId === state.currentBranchId && item.projectId === state.project.id);
  if (!changeSet) fail("NOT_FOUND", "Change set not found.", 404);
  return refresh(state, changeSet);
}

export const projectChangeSets = (state) => ensureCatalog(state)
  .filter(({ projectId, branchId }) => projectId === state.project.id && branchId === state.currentBranchId)
  .map((item) => {
    const { _baseWorkspace, ...projected } = refresh(state, item);
    return projected;
  });

function mergeBindingCurrent(state, changeSet) {
  if (!changeSet.merge) return true;
  const source = state.branches.find(({ id }) => id === changeSet.merge.sourceBranchId);
  return Boolean(source && source.headSnapshotId === changeSet.merge.sourceHead && source.workspace
    && workspaceHash(source.workspace) === changeSet.merge.sourceWorkspaceHash);
}

function assertMergeBinding(state, changeSet) {
  if (!mergeBindingCurrent(state, changeSet)) fail("STALE_MERGE_SOURCE", "The merge source changed.");
}

function assertOriginRun(state, changeSet) { const run = changeSet.runId ? state.runs.find(({ id }) => id === changeSet.runId) : null;
  if (changeSet.runId && !run) fail("RUN_NOT_FOUND", "The originating run is unavailable."); if (run?.state === "cancelled"
    || run?.cancellationRequested) fail("RUN_CANCELLED", "Cancelled run output cannot be used."); }

function assertDerivedParent(state, child) {
  if (!child.parentChangeSetId) return;
  const parent = ensureCatalog(state).find(({ id, branchId, projectId }) => id === child.parentChangeSetId
    && branchId === child.branchId && projectId === child.projectId);
  if (!parent) fail("PARENT_NOT_FOUND", "The parent change set is unavailable.");
  if (parent.parentChangeSetId) fail("RECURSIVE_DERIVATION_FORBIDDEN", "Only root change sets can be derived.", 422);
  if (parent.schemaVersion !== 2 || parent.policyVersion !== 2) fail("POLICY_MISMATCH", "The parent approval policy does not match.");
  if (parent.hash !== child.parentChangeSetHash || changeSetHash(parent) !== parent.hash) fail("PARENT_HASH_MISMATCH", "The parent immutable hash does not match.");
  if (parent.status !== "pending") fail("CHANGESET_CLOSED", "The parent change set is closed.");
  if (parent.runId !== child.runId) fail("PARENT_RUN_MISMATCH", "The parent origin run does not match.");
  assertOriginRun(state, parent);
  const selected = new Set(child.parentChangeIds);
  if (selected.size !== child.entries.length || child.entries.some(({ id }) => !selected.has(id))
    || child.parentChangeIds.some((id) => !parent.entries.some(({ id: parentId }) => parentId === id))) fail("PARENT_SELECTION_MISMATCH", "The derived selection does not match the parent.");
  for (const bundle of parent.bundles) {
    const count = bundle.changeIds.filter((id) => selected.has(id)).length; if (count > 0 && count < bundle.changeIds.length) fail("BUNDLE_SPLIT", "A required bundle cannot be split.", 422);
  }
}

export function commitChangeSet(state, id, input) {
  const stored = ensureCatalog(state).find((item) => item.id === id);
  if (!stored || stored.branchId !== state.currentBranchId || stored.projectId !== state.project.id) fail("NOT_FOUND", "Change set not found.", 404);
  if (stored.status !== "pending") fail("CHANGESET_CLOSED", "Only pending change sets can be committed.");
  if (stored.schemaVersion !== 2 || stored.policyVersion !== 2 || input.policyVersion !== stored.policyVersion || input.decision !== "accept") fail("POLICY_MISMATCH", "The approval policy does not match.");
  if (input.approvedHash !== stored.hash || changeSetHash(stored) !== stored.hash) fail("HASH_MISMATCH", "The approved immutable hash does not match.");
  assertDerivedParent(state, stored);
  if (input.expectedHead !== state.head || stored.baseSnapshotId !== state.head) fail("STALE_HEAD", "The branch head changed.");
  if (stored.baseWorkspaceHash !== workspaceHash(state)) fail("STALE_WORKSPACE", "The workspace changed without a head advance.");
  if (stored.impact.incomplete) fail("IMPACT_INCOMPLETE", "Impact analysis is incomplete.");
  if (stored.issues.length) fail("VALIDATION_ISSUES", "The proposal has unresolved validation issues.");
  const reviewed = new Set(input.reviewedKeys);
  const identified = new Set(stored.impact.reviewSet.map(({ key }) => key));
  if (input.reviewedKeys.some((key) => !identified.has(key))) fail("REVIEW_KEY_INVALID", "Review evidence contains an unidentified target.", 422);
  if (stored.requiredReviewKeys.some((key) => !reviewed.has(key))) fail("REVIEW_REQUIRED", "All unchanged affected targets require explicit review.");
  assertIdleWorkspace(state);
  assertOriginRun(state, stored);
  assertMergeBinding(state, stored);
  const projected = validateWorkspace(canonicalWorkspace(state), stored.entries, stored.merge?.protectionRequirements);
  installWorkspace(state, projected);
  for (const entry of stored.entries) {
    if (entry.kind === "scene" && entry.after && state.drafts[entry.artifactId]?.text === entry.after.text) delete state.drafts[entry.artifactId];
  }
  stored.status = "committed";
  const parent = stored.parentChangeSetId ? ensureCatalog(state).find(({ id: parentId }) => parentId === stored.parentChangeSetId) : null;
  if (parent) parent.status = "partially_applied";
  for (const feedback of state.feedback.filter(({ id: feedbackId }) => stored.feedbackIds.includes(feedbackId))) {
    if (feedback.state === "closed") continue;
    feedback.state = parent ? "partially_applied" : "applied";
  }
  completeRunWhenDecided(state, stored.runId);
  const options = stored.merge ? { mergeParentSnapshotId: stored.merge.sourceHead,
    mergeSource: { branchId: stored.merge.sourceBranchId, headSnapshotId: stored.merge.sourceHead,
      workspaceHash: stored.merge.sourceWorkspaceHash, changeSetId: stored.id } } : undefined;
  const snapshot = advanceSnapshot(state, `Change set committed: ${stored.reason}`, options);
  appendEvent(state, "changeset.committed", { changeSetId: stored.id, snapshotId: snapshot.id, humanRequested: true });
  return { head: state.head, changeSet: refresh(state, stored), snapshot };
}

export function rejectChangeSet(state, id) {
  const stored = ensureCatalog(state).find((item) => item.id === id);
  if (!stored || stored.branchId !== state.currentBranchId) fail("NOT_FOUND", "Change set not found.", 404);
  if (stored.status !== "pending" && stored.status !== "stale_candidate") fail("CHANGESET_CLOSED", "Change set is already closed.");
  stored.status = "rejected";
  for (const feedback of state.feedback.filter(({ id: feedbackId }) => stored.feedbackIds.includes(feedbackId))) {
    if (feedback.state === "awaiting_decision") feedback.state = "open";
  }
  completeRunWhenDecided(state, stored.runId);
  appendEvent(state, "changeset.rejected", { changeSetId: id, humanRequested: true });
  return refresh(state, stored);
}

export function deriveChangeSet(state, id, { changeIds }) {
  const parent = ensureCatalog(state).find((item) => item.id === id && item.branchId === state.currentBranchId && item.projectId === state.project.id);
  if (!parent) fail("NOT_FOUND", "Change set not found.", 404);
  if (parent.parentChangeSetId) fail("RECURSIVE_DERIVATION_FORBIDDEN", "Only root change sets can be derived.", 422);
  if (parent.kind === "merge") fail("PARTIAL_MERGE_FORBIDDEN", "Merge change sets cannot be derived.", 422);
  if (parent.status !== "pending") fail("CHANGESET_CLOSED", "Only pending change sets can be derived.");
  if (parent.schemaVersion !== 2 || parent.policyVersion !== 2) fail("POLICY_MISMATCH", "The parent approval policy does not match.");
  if (changeSetHash(parent) !== parent.hash) fail("HASH_MISMATCH", "The parent immutable hash does not match.");
  assertOriginRun(state, parent);
  if (parent.baseSnapshotId !== state.head) fail("STALE_HEAD", "The parent branch head changed.");
  if (parent.baseWorkspaceHash !== workspaceHash(state)) fail("STALE_WORKSPACE", "The parent workspace changed.");
  const selected = new Set(changeIds);
  if (changeIds.some((changeId) => !parent.entries.some(({ id: entryId }) => entryId === changeId))) fail("CHANGE_NOT_FOUND", "A selected change does not exist.", 422);
  for (const bundle of parent.bundles) {
    const count = bundle.changeIds.filter((changeId) => selected.has(changeId)).length;
    if (count > 0 && count < bundle.changeIds.length) fail("BUNDLE_SPLIT", "A required bundle cannot be split.", 422);
  }
  const changes = parent.entries.filter(({ id: changeId }) => selected.has(changeId)).map(({ kind, artifactId, after }) => ({ kind, artifactId, after }));
  const child = createChangeSet(state, { kind: parent.kind, reason: parent.reason, changes,
    baseSnapshotId: parent.baseSnapshotId, baseWorkspaceHash: parent.baseWorkspaceHash,
    baseWorkspace: parent._baseWorkspace, feedbackIds: parent.feedbackIds, runId: parent.runId,
    candidateId: parent.candidateId, parentChangeSetId: parent.id, parentChangeSetHash: parent.hash,
    parentChangeIds: changeIds, atomic: false, merge: parent.merge });
  const stored = ensureCatalog(state).find(({ id: childId }) => childId === child.id);
  const reviewKeys = new Set(stored.impact.reviewSet.map(({ key }) => key));
  for (const entry of parent.entries.filter(({ id: entryId }) => !selected.has(entryId))) if (!reviewKeys.has(entry.key)) {
    stored.impact.reviewSet.push({ key: entry.key, kind: entry.kind, artifactId: entry.artifactId,
      title: entry.title, reasons: ["omitted-parent-change"], mandatory: true, changed: false });
  }
  stored.impact.reviewSet.sort((left, right) => left.key < right.key ? -1 : left.key > right.key ? 1 : 0);
  stored.requiredReviewKeys = stored.impact.reviewSet.filter(({ changed }) => !changed).map(({ key }) => key).sort();
  stored.hash = changeSetHash(stored);
  return refresh(state, stored);
}

export function promoteCandidate(state, id, { expectedHead }) {
  const candidate = state.candidates.find((item) => item.id === id);
  if (!candidate) fail("NOT_FOUND", "Candidate not found.", 404);
  assertRecordBranch(state, candidate);
  if (candidate.status !== "pending") fail("CANDIDATE_CLOSED", "Candidate is already closed.");
  if (candidate.hash !== candidateHash(candidate)) fail("CANDIDATE_HASH_MISMATCH", "Candidate integrity check failed.");
  if (expectedHead !== state.head) fail("STALE_HEAD", "The branch head changed.");
  const run = candidate.runId ? state.runs.find(({ id: runId }) => runId === candidate.runId) : null;
  if (run?.state === "cancelled" || run?.cancellationRequested) fail("RUN_CANCELLED", "Cancelled run output cannot be promoted.");
  const fresh = candidate.baseSnapshotId === state.head;
  if (fresh && (candidate.contextVersion ?? 0) !== (state.contextVersion ?? 0)) fail("STALE_CONTEXT", "Candidate context changed.");
  const snapshot = fresh ? null : state.snapshots.find(({ id: snapshotId }) => snapshotId === candidate.baseSnapshotId);
  const captured = fresh ? { workspace: canonicalWorkspace(state), contextKnown: true } : snapshot ? workspaceFromSnapshot(snapshot) : null;
  if (!captured?.contextKnown) fail("BASE_WORKSPACE_UNKNOWN", "Candidate base context is unavailable.");
  const before = captured.workspace.scenes.find(({ id: sceneId }) => sceneId === candidate.sceneId);
  const result = createChangeSet(state, { kind: "candidate", reason: candidate.reason,
    changes: [{ kind: "scene", artifactId: candidate.sceneId, after: { ...before, text: candidate.after } }],
    baseSnapshotId: candidate.baseSnapshotId, baseWorkspaceHash: workspaceHash(captured.workspace), baseWorkspace: captured.workspace,
    feedbackIds: candidate.feedbackId ? [candidate.feedbackId] : [], runId: candidate.runId ?? null,
    candidateId: candidate.id, parentChangeSetId: null, atomic: false, merge: null });
  candidate.status = "superseded";
  candidate.changeSetId = result.id;
  return result;
}

function completeRunWhenDecided(state, runId) {
  if (!runId) return;
  const run = state.runs.find(({ id }) => id === runId);
  const pending = ensureCatalog(state).some((changeSet) => changeSet.runId === runId && changeSet.status === "pending");
  if (run && !pending) run.state = "completed";
}

export function resolveFeedback(state, id, input) {
  if (input.expectedHead !== state.head) fail("STALE_HEAD", "The branch head changed.");
  const feedback = state.feedback.find((item) => item.id === id);
  if (!feedback) fail("NOT_FOUND", "Feedback not found.", 404);
  feedback.state = input.decision === "close" ? "closed" : input.decision === "defer" ? "deferred" : "open";
  feedback.resolutionNote = input.note;
  feedback.resolvedAt = new Date().toISOString();
  appendEvent(state, "feedback.resolved", { feedbackId: id, decision: input.decision, actor: "local-owner", note: input.note });
  return feedback;
}
