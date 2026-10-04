import assert from "node:assert/strict";
import test from "node:test";

import { validateWorkspace } from "../packages/revision/change-entries.mjs";
import { changeSetHash } from "../packages/revision/change-set-hash.mjs";
import { commitChangeSet, createChangeSet, getChangeSet, promoteCandidate } from "../packages/revision/changesets.mjs";
import { canonicalWorkspace, workspaceHash } from "../packages/revision/workspace.mjs";
import { addCandidate } from "./domain.mjs";
import { createSeed } from "./seed.mjs";

const input = (state, changes, extra = {}) => ({ kind: "manual", reason: "hardening", changes,
  baseSnapshotId: state.head, baseWorkspaceHash: workspaceHash(state), feedbackIds: [], runId: null,
  candidateId: null, parentChangeSetId: null, atomic: false, merge: null, ...extra });

test("Given an entry whose payload ID differs, when projected, then artifact identity is rejected", () => {
  const base = canonicalWorkspace(createSeed());
  const scene = base.scenes[0];
  assert.throws(() => validateWorkspace(base, [{ kind: "scene", artifactId: scene.id, after: { ...scene, id: "scene-other" } }]),
    ({ code }) => code === "INVALID_ARTIFACT_ID");
});

test("Given protected metadata, when a proposal removes it but retains text, then protection removal is rejected", () => {
  const base = canonicalWorkspace(createSeed());
  const scene = base.scenes.find(({ id }) => id === "scene-7");
  assert.throws(() => validateWorkspace(base, [{ kind: "scene", artifactId: scene.id, after: { ...scene, protectedQuotes: [] } }]),
    ({ code }) => code === "PROTECTED_QUOTE_METADATA");
});

test("Given a declared protection absent from text, when projected, then invalid protection is rejected", () => {
  const base = canonicalWorkspace(createSeed());
  const scene = base.scenes[0];
  assert.throws(() => validateWorkspace(base, [{ kind: "scene", artifactId: scene.id,
    after: { ...scene, protectedQuotes: ["not in text"] } }]), ({ code }) => code === "PROTECTED_QUOTE");
});

test("Given immutable review and issue metadata, when either changes, then the hash changes", () => {
  const state = createSeed();
  const scene = state.scenes[0];
  const set = createChangeSet(state, input(state, [{ kind: "scene", artifactId: scene.id, after: { ...scene, text: "changed" } }]));
  assert.notEqual(changeSetHash({ ...set, requiredReviewKeys: [...set.requiredReviewKeys, "scene:extra"] }), set.hash);
  assert.notEqual(changeSetHash({ ...set, issues: [{ code: "X", message: "x", keys: [] }] }), set.hash);
  assert.notEqual(changeSetHash({ ...set, schemaVersion: 3 }), set.hash);
});

test("Given a semantic no-op manual proposal, when created, then it is rejected", () => {
  const state = createSeed();
  const scene = structuredClone(state.scenes[0]);
  assert.throws(() => createChangeSet(state, input(state, [{ kind: "scene", artifactId: scene.id, after: scene }])),
    ({ code }) => code === "NO_CHANGES");
});

test("Given invalid generated repair output, when captured, then it remains inspectable but blocked", () => {
  const state = createSeed();
  const scene = structuredClone(state.scenes.find(({ id }) => id === "scene-7"));
  const set = createChangeSet(state, input(state, [{ kind: "scene", artifactId: scene.id,
    after: { ...scene, protectedQuotes: [] } }], { kind: "repair", runId: "run-generated" }));
  assert.equal(set.status, "pending");
  assert.equal(set.canCommit, false);
  assert.ok(set.issues.some(({ code }) => code === "PROTECTED_QUOTE_METADATA"));
  assert.ok(set.blockedReasons.includes("VALIDATION_ISSUES"));
});

test("Given a captured repair base, when recorded later, then its captured context version is preserved", () => {
  const state = createSeed();
  const baseWorkspace = canonicalWorkspace(state);
  const baseWorkspaceHash = workspaceHash(baseWorkspace);
  state.scenes[0].summary = "newer workspace";
  const set = createChangeSet(state, input(state, [revisedScene(baseWorkspace.scenes[0])], { kind: "repair",
    baseWorkspace, baseWorkspaceHash, baseContextVersion: 7, runId: "run-stale" }));
  assert.equal(set.baseContextVersion, 7);
});

test("Given merge union protections, when projected metadata omits one, then validation rejects it", () => {
  const base = canonicalWorkspace(createSeed());
  const scene = base.scenes[0];
  assert.throws(() => validateWorkspace(base, [{ kind: "scene", artifactId: scene.id,
    after: { ...scene, text: `${scene.text} union quote` } }], { [`scene:${scene.id}`]: ["union quote"] }),
  ({ code }) => code === "MERGE_PROTECTION_VIOLATION");
});

function revisedScene(scene) {
  return { kind: "scene", artifactId: scene.id, after: { ...scene, text: `${scene.text} revised` } };
}

test("Given approval evidence outside the computed review set, when committing, then fake review is rejected", () => {
  const state = createSeed();
  const set = createChangeSet(state, input(state, [{ kind: "scene", artifactId: state.scenes[0].id,
    after: { ...state.scenes[0], text: "changed" } }]));
  assert.throws(() => commitChangeSet(state, set.id, { expectedHead: state.head, approvedHash: set.hash,
    reviewedKeys: [...set.requiredReviewKeys, "scene:invented"], decision: "accept", policyVersion: 2 }),
  ({ code }) => code === "REVIEW_KEY_INVALID");
});

test("Given active work, when a proposal is projected, then UI commit readiness is blocked", () => {
  const state = createSeed();
  const set = createChangeSet(state, input(state, [{ kind: "scene", artifactId: state.scenes[0].id,
    after: { ...state.scenes[0], text: "changed" } }]));
  state.runs.push({ id: "run-active", state: "running" });
  assert.ok(getChangeSet(state, set.id).blockedReasons.includes("RUN_ACTIVE"));
});

test("Given a pending proposal whose workspace is stale, when projected, then only its view is stale candidate", () => {
  const state = createSeed();
  const set = createChangeSet(state, input(state, [{ kind: "scene", artifactId: state.scenes[0].id,
    after: { ...state.scenes[0], text: "changed" } }]));
  state.scenes[1].summary = "concurrent";
  assert.equal(getChangeSet(state, set.id).status, "stale_candidate");
  assert.equal(state.changeSets.find(({ id }) => id === set.id).status, "pending");
});

test("Given a pending proposal from a cancelled run, when projected, then only its view is cancelled", () => {
  const state = createSeed();
  state.runs.push({ id: "run-cancelled-view", state: "awaiting_decision" });
  const set = createChangeSet(state, input(state, [{ kind: "scene", artifactId: state.scenes[0].id,
    after: { ...state.scenes[0], text: "changed" } }], { kind: "repair", runId: "run-cancelled-view" }));
  state.runs[0].state = "cancelled";
  assert.equal(getChangeSet(state, set.id).status, "cancelled");
  assert.equal(state.changeSets.find(({ id }) => id === set.id).status, "pending");
});

test("Given a fresh V1 candidate with current protection metadata, when promoted, then current workspace metadata is retained", () => {
  const state = createSeed();
  const scene = state.scenes[0];
  scene.protectedQuotes.push(scene.text);
  state.contextVersion = 1;
  const candidate = addCandidate(state, { input: { sceneId: scene.id, instruction: "revise", baseSnapshotId: state.head },
    proposedText: `${scene.text} revised`, adapterLabel: "test", contextVersion: 1, branchId: state.currentBranchId });
  const set = promoteCandidate(state, candidate.id, { expectedHead: state.head });
  assert.deepEqual(set.entries[0].after.protectedQuotes, [scene.text]);
});

test("Given a tampered V1 candidate, when promotion is requested, then its legacy hash prevents reuse", () => {
  const state = createSeed();
  const scene = state.scenes[0];
  const candidate = addCandidate(state, { input: { sceneId: scene.id, instruction: "revise", baseSnapshotId: state.head },
    proposedText: `${scene.text} revised`, adapterLabel: "test", contextVersion: 0, branchId: state.currentBranchId });
  candidate.after = "tampered";
  assert.throws(() => promoteCandidate(state, candidate.id, { expectedHead: state.head }),
    ({ code }) => code === "CANDIDATE_HASH_MISMATCH");
});
