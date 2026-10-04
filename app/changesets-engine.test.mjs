import assert from "node:assert/strict";
import test from "node:test";

import { createChangeSet, commitChangeSet, deriveChangeSet } from "../packages/revision/changesets.mjs";
import { createSeed } from "./seed.mjs";
import { canonicalWorkspace, workspaceHash } from "../packages/revision/workspace.mjs";

const manual = (state, changes, extra = {}) => ({ kind: "manual", reason: "Human revision", changes,
  baseSnapshotId: state.head, baseWorkspaceHash: workspaceHash(state), feedbackIds: [], runId: null,
  candidateId: null, parentChangeSetId: null, atomic: false, merge: null, ...extra });

test("Given a multi-artifact proposal, when created, then before values are authoritative and global changes form one bundle", () => {
  const state = createSeed();
  const scene = structuredClone(state.scenes[0]);
  const set = createChangeSet(state, manual(state, [
    { kind: "scene", artifactId: scene.id, after: { ...scene, text: "revised" } },
    { kind: "plan", artifactId: state.plans[0].id, after: { ...state.plans[0], description: "revised plan" } },
  ]));
  assert.equal(set.entries[0].before.text, scene.text);
  assert.equal(set.bundles.length, 1);
  assert.ok(set.requiredReviewKeys.length > 0);
});

test("Given an unchanged affected target, when commit lacks review evidence, then nothing mutates", () => {
  const state = createSeed();
  const scene = structuredClone(state.scenes.find(({ id }) => id === "scene-7"));
  const set = createChangeSet(state, manual(state, [{ kind: "scene", artifactId: scene.id, after: { ...scene, text: `${scene.text}\nrevision` } }]));
  const before = canonicalWorkspace(state);
  assert.throws(() => commitChangeSet(state, set.id, { expectedHead: state.head, approvedHash: set.hash, reviewedKeys: [], decision: "accept", policyVersion: 2 }),
    ({ code }) => code === "REVIEW_REQUIRED");
  assert.deepEqual(canonicalWorkspace(state), before);
});

test("Given a complete review, when workspace changed without head advancing, then commit is stale", () => {
  const state = createSeed();
  const scene = structuredClone(state.scenes[0]);
  const set = createChangeSet(state, manual(state, [{ kind: "scene", artifactId: scene.id, after: { ...scene, text: "revision" } }]));
  state.scenes[1].summary = "concurrent edit";
  assert.throws(() => commitChangeSet(state, set.id, { expectedHead: state.head, approvedHash: set.hash,
    reviewedKeys: set.requiredReviewKeys, decision: "accept", policyVersion: 2 }), ({ code }) => code === "STALE_WORKSPACE");
});

test("Given a server-required bundle, when only part is derived, then derivation is rejected", () => {
  const state = createSeed();
  const set = createChangeSet(state, manual(state, state.scenes.slice(0, 2).map((scene) =>
    ({ kind: "scene", artifactId: scene.id, after: { ...scene, text: `${scene.text} revised` } })), { atomic: true }));
  assert.throws(() => deriveChangeSet(state, set.id, { changeIds: [set.entries[0].id] }), ({ code }) => code === "BUNDLE_SPLIT");
});

test("Given a protected scene in an atomic proposal, when deletion is validated, then no proposal or workspace mutation occurs", () => {
  const state = createSeed();
  const before = canonicalWorkspace(state);
  assert.throws(() => createChangeSet(state, manual(state, [
    { kind: "scene", artifactId: "scene-1", after: { ...state.scenes[0], text: "would have changed" } },
    { kind: "scene", artifactId: "scene-7", after: null },
  ], { atomic: true })), ({ code }) => code === "PROTECTED_SCENE");
  assert.deepEqual(canonicalWorkspace(state), before);
  assert.equal(state.changeSets?.length ?? 0, 0);
});

test("Given a cancelled originating run, when its change set is committed, then commit is blocked", () => {
  const state = createSeed();
  state.runs.push({ id: "run-cancelled", state: "cancelled", cancellationRequested: true });
  const scene = structuredClone(state.scenes[0]);
  const set = createChangeSet(state, manual(state, [{ kind: "scene", artifactId: scene.id, after: { ...scene, text: "revision" } }],
    { kind: "repair", runId: "run-cancelled" }));
  assert.throws(() => commitChangeSet(state, set.id, { expectedHead: state.head, approvedHash: set.hash,
    reviewedKeys: set.requiredReviewKeys, decision: "accept", policyVersion: 2 }), ({ code }) => code === "RUN_CANCELLED");
});
