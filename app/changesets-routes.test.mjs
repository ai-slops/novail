import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createApp } from "./api.mjs";
import { FileStore } from "./store.mjs";

const post = (app, path, body) => app.request(path, { method: "POST",
  headers: { "content-type": "application/json", "idempotency-key": randomUUID() }, body: JSON.stringify(body) });

test("Given a FileStore workspace, when V2 manual proposal and commit routes are used, then one snapshot installs the revision", async () => {
  const directory = await mkdtemp(join(tmpdir(), "novail-changeset-"));
  const store = new FileStore(join(directory, "state.json"));
  await store.initialize();
  const app = createApp({ store, distRoot: directory });
  try {
    const contextResponse = await app.request("/api/revision-context");
    const context = await contextResponse.json();
    const scene = context.workspace.scenes.find(({ id }) => id === "scene-1");
    const createdResponse = await post(app, "/api/change-sets", { baseSnapshotId: context.baseSnapshotId,
      baseWorkspaceHash: context.workspaceHash, reason: "Revise opening", feedbackIds: [], atomic: false,
      changes: [{ kind: "scene", artifactId: scene.id, after: { ...scene, text: "A revised opening" } }] });
    const created = await createdResponse.json();
    const projectedState = await (await app.request("/api/state")).json();
    const committedResponse = await post(app, `/api/change-sets/${created.id}/commit`, { expectedHead: context.baseSnapshotId,
      approvedHash: created.hash, reviewedKeys: created.requiredReviewKeys, decision: "accept", policyVersion: 2 });
    const committed = await committedResponse.json();
    assert.equal(contextResponse.status, 200);
    assert.equal(createdResponse.status, 201);
    assert.equal(projectedState.workspaceHash, context.workspaceHash);
    assert.equal(projectedState.changeSets.some(({ id }) => id === created.id), true);
    assert.equal(committedResponse.status, 200);
    assert.notEqual(committed.head, context.baseSnapshotId);
    assert.equal((await store.read()).scenes.find(({ id }) => id === scene.id).text, "A revised opening");
  } finally {
    await store.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("Given an unknown request property, when manual route parses it, then strict schema rejects it", async () => {
  const directory = await mkdtemp(join(tmpdir(), "novail-changeset-schema-"));
  const store = new FileStore(join(directory, "state.json"));
  await store.initialize();
  const app = createApp({ store, distRoot: directory });
  try {
    const response = await post(app, "/api/change-sets", { unexpected: true });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.code, "SCHEMA_INVALID");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
