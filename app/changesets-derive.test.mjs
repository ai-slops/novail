import assert from "node:assert/strict";
import test from "node:test";

import { changeSetHash } from "../packages/revision/change-set-hash.mjs";
import { commitChangeSet, createChangeSet, deriveChangeSet, rejectChangeSet } from "../packages/revision/changesets.mjs";
import { workspaceHash } from "../packages/revision/workspace.mjs";
import { createSeed } from "./seed.mjs";

const proposal = (state, changes, extra = {}) => ({ kind: "manual", reason: "partial", changes,
  baseSnapshotId: state.head, baseWorkspaceHash: workspaceHash(state), feedbackIds: [], runId: null,
  candidateId: null, parentChangeSetId: null, atomic: false, merge: null, ...extra });
const revised = (scene, text = `${scene.text} revised`) => ({ kind: "scene", artifactId: scene.id, after: { ...scene, text } });

function addDisconnectedScenes(state) {
  const make = (id) => ({ id, title: id, chapter: 30, status: "canon", text: id, summary: "", storyTime: "later",
    characters: [id], protectedQuotes: [] });
  const scenes = [make("scene-alpha"), make("scene-beta")];
  state.scenes.push(...scenes);
  return scenes;
}

test("Given a parent proposal whose workspace became stale, when deriving, then derivation is rejected", () => {
  const state = createSeed();
  const set = createChangeSet(state, proposal(state, [revised(state.scenes[0])]));
  state.scenes[1].summary = "concurrent";
  assert.throws(() => deriveChangeSet(state, set.id, { changeIds: [set.entries[0].id] }), ({ code }) => code === "STALE_WORKSPACE");
});

test("Given a merge change set, when derivation is requested, then partial merge is explicitly forbidden", () => {
  const state = createSeed();
  const set = createChangeSet(state, proposal(state, [revised(state.scenes[0])], { kind: "merge", atomic: true,
    merge: { previewId: "preview", previewHash: "a".repeat(64), sourceBranchId: "source", sourceHead: "source-head",
      sourceWorkspaceHash: "b".repeat(64), targetWorkspaceHash: workspaceHash(state), baseSnapshotId: state.head } }));
  assert.throws(() => deriveChangeSet(state, set.id, { changeIds: [set.entries[0].id] }), ({ code }) => code === "PARTIAL_MERGE_FORBIDDEN");
});

test("Given omitted parent changes, when deriving one independent bundle, then omitted targets require review", () => {
  const state = createSeed();
  const [alpha, beta] = addDisconnectedScenes(state);
  const parent = createChangeSet(state, proposal(state, [revised(alpha), revised(beta)]));
  const selected = parent.entries.find(({ artifactId }) => artifactId === alpha.id);
  const child = deriveChangeSet(state, parent.id, { changeIds: [selected.id] });
  assert.ok(child.requiredReviewKeys.includes(`scene:${beta.id}`));
  assert.ok(child.impact.reviewSet.some(({ key, changed }) => key === `scene:${beta.id}` && !changed));
});

test("Given a derived change set, when deriving again, then recursive derivation is rejected", () => {
  const state = createSeed();
  const [alpha, beta] = addDisconnectedScenes(state);
  const parent = createChangeSet(state, proposal(state, [revised(alpha), revised(beta)]));
  const child = deriveChangeSet(state, parent.id, { changeIds: [parent.entries[0].id] });
  assert.throws(() => deriveChangeSet(state, child.id, { changeIds: [child.entries[0].id] }),
    ({ code }) => code === "RECURSIVE_DERIVATION_FORBIDDEN");
});

test("Given tampered parent immutable metadata, when deriving, then parent integrity is rejected", () => {
  for (const field of ["hash", "schemaVersion", "policyVersion"]) {
    const state = createSeed();
    const parent = createChangeSet(state, proposal(state, [revised(state.scenes[0])]));
    const storedParent = state.changeSets.find(({ id }) => id === parent.id);
    if (field === "hash") storedParent.hash = "0".repeat(64);
    else {
      storedParent[field] += 1;
      storedParent.hash = changeSetHash(storedParent);
    }
    assert.throws(() => deriveChangeSet(state, parent.id, { changeIds: [parent.entries[0].id] }),
      ({ code }) => code === (field === "hash" ? "HASH_MISMATCH" : "POLICY_MISMATCH"), field);
  }
});

test("Given a cancelled origin run, when deriving its proposal, then derivation is rejected", () => {
  const state = createSeed();
  state.runs.push({ id: "run-derived-cancelled", state: "cancelled", cancellationRequested: true });
  const parent = createChangeSet(state, proposal(state, [revised(state.scenes[0])],
    { kind: "repair", runId: "run-derived-cancelled" }));
  assert.throws(() => deriveChangeSet(state, parent.id, { changeIds: [parent.entries[0].id] }),
    ({ code }) => code === "RUN_CANCELLED");
});

test("Given a derived child whose parent was tampered, when committing, then parent integrity is rejected", () => {
  const state = createSeed();
  const [alpha, beta] = addDisconnectedScenes(state);
  const parent = createChangeSet(state, proposal(state, [revised(alpha), revised(beta)]));
  const child = deriveChangeSet(state, parent.id, { changeIds: [parent.entries[0].id] });
  state.changeSets.find(({ id }) => id === parent.id).reason = "tampered after derivation";
  assert.throws(() => commitChangeSet(state, child.id, { expectedHead: state.head, approvedHash: child.hash,
    reviewedKeys: child.requiredReviewKeys, decision: "accept", policyVersion: 2 }),
  ({ code }) => code === "PARENT_HASH_MISMATCH");
});

test("Given selected parent changes no longer contain a whole bundle, when committing, then laundering is rejected", () => {
  const state = createSeed();
  const [alpha, beta] = addDisconnectedScenes(state);
  const parent = createChangeSet(state, proposal(state, [revised(alpha), revised(beta)]));
  const child = deriveChangeSet(state, parent.id, { changeIds: [parent.entries[0].id] });
  const storedParent = state.changeSets.find(({ id }) => id === parent.id);
  const storedChild = state.changeSets.find(({ id }) => id === child.id);
  storedParent.bundles = [{ ...storedParent.bundles[0], changeIds: storedParent.entries.map(({ id }) => id) }];
  storedParent.hash = changeSetHash(storedParent);
  storedChild.parentChangeSetHash = storedParent.hash;
  storedChild.hash = changeSetHash(storedChild);
  assert.throws(() => commitChangeSet(state, child.id, { expectedHead: state.head, approvedHash: storedChild.hash,
    reviewedKeys: storedChild.requiredReviewKeys, decision: "accept", policyVersion: 2 }),
  ({ code }) => code === "BUNDLE_SPLIT");
});

test("Given feedback on a partially adopted parent, when child commits, then feedback is partially applied", () => {
  const state = createSeed();
  const [alpha, beta] = addDisconnectedScenes(state);
  state.feedback.push({ id: "feedback-partial", sceneId: alpha.id, text: "revise", scope: "scene", state: "open" });
  const parent = createChangeSet(state, proposal(state, [revised(alpha), revised(beta)], { feedbackIds: ["feedback-partial"] }));
  const selected = parent.entries.find(({ artifactId }) => artifactId === alpha.id);
  const child = deriveChangeSet(state, parent.id, { changeIds: [selected.id] });
  commitChangeSet(state, child.id, { expectedHead: state.head, approvedHash: child.hash,
    reviewedKeys: child.requiredReviewKeys, decision: "accept", policyVersion: 2 });
  assert.equal(state.feedback[0].state, "partially_applied");
});

test("Given closed feedback, when its full proposal commits, then human closure remains closed", () => {
  const state = createSeed();
  state.feedback.push({ id: "feedback-closed", sceneId: state.scenes[0].id, text: "revise", scope: "scene", state: "open" });
  const set = createChangeSet(state, proposal(state, [revised(state.scenes[0])], { feedbackIds: ["feedback-closed"] }));
  state.feedback[0].state = "closed";
  commitChangeSet(state, set.id, { expectedHead: state.head, approvedHash: set.hash,
    reviewedKeys: set.requiredReviewKeys, decision: "accept", policyVersion: 2 });
  assert.equal(state.feedback[0].state, "closed");
});

test("Given an originating run with one proposal, when rejected, then the run is completed", () => {
  const state = createSeed();
  state.runs.push({ id: "run-reject", state: "awaiting_decision" });
  const set = createChangeSet(state, proposal(state, [revised(state.scenes[0])], { kind: "repair", runId: "run-reject" }));
  rejectChangeSet(state, set.id);
  assert.equal(state.runs[0].state, "completed");
});
