import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createApp } from "./api.mjs";
import { FileStore } from "./store.mjs";

const post = (app, path, body) => app.request(path, {
  method: "POST",
  headers: { "content-type": "application/json", "idempotency-key": randomUUID() },
  body: JSON.stringify(body),
});

const fixture = async () => {
  const directory = await mkdtemp(join(tmpdir(), "novail-invariants-"));
  const store = new FileStore(join(directory, "state.json"));
  await store.initialize();
  return { app: createApp({ store, distRoot: directory }), cleanup: () => rm(directory, { recursive: true, force: true }) };
};

test("Given a saved draft, when state is reloaded, then the draft remains visible", async () => {
  const { app, cleanup } = await fixture();
  try {
    const initial = await (await app.request("/api/state")).json();
    await post(app, "/api/scenes/scene-7/draft", { text: "지속되는 초고", baseSnapshotId: initial.head });
    const reloaded = await (await app.request("/api/state")).json();
    assert.equal(reloaded.drafts["scene-7"].text, "지속되는 초고");
  } finally {
    await cleanup();
  }
});

test("Given an active manuscript, when a new project is created and the old one reopened, then their content stays isolated", async () => {
  const { app, cleanup } = await fixture();
  try {
    const original = await (await app.request("/api/state")).json();
    await post(app, "/api/scenes/scene-7/draft", { text: "이전 프로젝트 초고", baseSnapshotId: original.head });
    const projectResponse = await post(app, "/api/projects", { title: "새 바다", direction: "새로운 방향" });
    const created = await projectResponse.json();
    const emptyProject = await (await app.request("/api/state")).json();
    assert.equal(emptyProject.scenes.length, 0);
    assert.equal(emptyProject.project.id, created.id);
    await post(app, `/api/projects/${original.project.id}/switch`, {});
    const reopened = await (await app.request("/api/state")).json();
    assert.equal(reopened.scenes.length, 7);
    assert.equal(reopened.drafts["scene-7"].text, "이전 프로젝트 초고");
  } finally {
    await cleanup();
  }
});

test("Given feedback linked to a candidate, when it is proposed then committed, then feedback moves from awaiting decision to applied", async () => {
  const { app, cleanup } = await fixture();
  try {
    const initial = await (await app.request("/api/state")).json();
    const scene = initial.scenes.find((item) => item.id === "scene-7");
    const feedback = await (await post(app, "/api/feedback", { sceneId: scene.id, text: "결의를 추가", scope: "scene" })).json();
    const candidate = await (await post(app, "/api/candidates", {
      sceneId: scene.id, feedbackId: feedback.id, instruction: "결의를 추가", proposedText: `${scene.text}\n\n결의했다.`, baseSnapshotId: initial.head,
    })).json();
    const awaiting = await (await app.request("/api/state")).json();
    assert.equal(awaiting.feedback.find((item) => item.id === feedback.id).state, "awaiting_decision");
    await post(app, `/api/candidates/${candidate.id}/commit`, { expectedHead: initial.head, hash: candidate.hash });
    const applied = await (await app.request("/api/state")).json();
    assert.equal(applied.feedback.find((item) => item.id === feedback.id).state, "applied");
  } finally {
    await cleanup();
  }
});

test("Given a scene added after a snapshot, when that snapshot is restored, then exact scene membership returns", async () => {
  const { app, cleanup } = await fixture();
  try {
    const initial = await (await app.request("/api/state")).json();
    const added = await (await post(app, "/api/scenes", { title: "임시 장면", text: "나중에 생긴 장면" })).json();
    const response = await post(app, "/api/restore", { snapshotId: initial.head, expectedHead: added.head });
    const restored = await response.json();
    assert.equal(response.status, 200);
    assert.equal(restored.scenes.length, initial.scenes.length);
    assert.equal(restored.scenes.some((scene) => scene.id === added.scene.id), false);
  } finally {
    await cleanup();
  }
});

test("Given a candidate, when commit hash is wrong, then approval is rejected without advancing head", async () => {
  const { app, cleanup } = await fixture();
  try {
    const initial = await (await app.request("/api/state")).json();
    const scene = initial.scenes.find((item) => item.id === "scene-7");
    const candidate = await (await post(app, "/api/candidates", {
      sceneId: scene.id, instruction: "검증", proposedText: scene.text, baseSnapshotId: initial.head,
    })).json();
    const response = await post(app, `/api/candidates/${candidate.id}/commit`, { expectedHead: initial.head, hash: "0".repeat(64) });
    assert.equal(response.status, 409);
    assert.equal((await response.json()).error.code, "HASH_MISMATCH");
  } finally {
    await cleanup();
  }
});
