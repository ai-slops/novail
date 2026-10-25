import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { randomUUID } from "node:crypto";

import { createApp } from "./api.mjs";
import { FileStore } from "./store.mjs";

const post = (app, path, body, key = randomUUID()) =>
  app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": key },
    body: JSON.stringify(body),
  });

const fixture = async () => {
  const directory = await mkdtemp(join(tmpdir(), "novail-api-"));
  const store = new FileStore(join(directory, "state.json"));
  await store.initialize();
  return {
    app: createApp({ store, distRoot: directory }),
    cleanup: () => rm(directory, { recursive: true, force: true }),
  };
};

test("Given seed state, when state is read, then chapter 7 and distant review promise exist", async () => {
  const { app, cleanup } = await fixture();
  try {
    const response = await app.request("/api/state");
    const state = await response.json();
    assert.equal(response.status, 200);
    assert.equal(state.scenes.find((scene) => scene.id === "scene-7").chapter, 7);
    assert.ok(state.scenes.find((scene) => scene.chapter === 18));
  } finally {
    await cleanup();
  }
});

test("Given a canonical scene, when a draft is saved, then canonical text and head stay unchanged", async () => {
  const { app, cleanup } = await fixture();
  try {
    const before = await (await app.request("/api/state")).json();
    const response = await post(app, "/api/scenes/scene-7/draft", {
      text: "아직 승인하지 않은 초고",
      baseSnapshotId: before.head,
    });
    const after = await (await app.request("/api/state")).json();
    assert.equal(response.status, 200);
    assert.equal(after.head, before.head);
    assert.equal(after.scenes.find((scene) => scene.id === "scene-7").text,
      before.scenes.find((scene) => scene.id === "scene-7").text);
  } finally {
    await cleanup();
  }
});

test("Given feedback, when a candidate is created, then head stays unchanged and chapter 18 is reviewed", async () => {
  const { app, cleanup } = await fixture();
  try {
    const before = await (await app.request("/api/state")).json();
    const feedbackResponse = await post(app, "/api/feedback", {
      sceneId: "scene-7", text: "봉인의 대가를 더 분명히", scope: "scene",
    });
    const feedback = await feedbackResponse.json();
    const candidateResponse = await post(app, "/api/candidates", {
      sceneId: "scene-7",
      feedbackId: feedback.id,
      instruction: "리라의 선택을 강조해 주세요.",
      proposedText: `${before.scenes.find((scene) => scene.id === "scene-7").text}\n\n리라는 대가를 알고도 인장을 눌렀다.`,
      baseSnapshotId: before.head,
    });
    const candidate = await candidateResponse.json();
    const after = await (await app.request("/api/state")).json();
    assert.equal(candidateResponse.status, 201);
    assert.equal(after.head, before.head);
    assert.ok(candidate.reviewSet.some((item) => item.sceneId === "scene-18" && item.mandatory));
  } finally {
    await cleanup();
  }
});

test("Given an approved candidate, when committed with exact guards, then a snapshot advances head", async () => {
  const { app, cleanup } = await fixture();
  try {
    const before = await (await app.request("/api/state")).json();
    const scene = before.scenes.find((item) => item.id === "scene-7");
    const candidate = await (await post(app, "/api/candidates", {
      sceneId: scene.id,
      instruction: "마지막에 짧은 결의를 추가해 주세요.",
      proposedText: `${scene.text}\n\n카엘은 고개를 끄덕였다.`,
      baseSnapshotId: before.head,
    })).json();
    const response = await post(app, `/api/candidates/${candidate.id}/commit`, {
      expectedHead: before.head, hash: candidate.hash,
    });
    const committed = await response.json();
    assert.equal(response.status, 200);
    assert.notEqual(committed.head, before.head);
    assert.equal(committed.candidate.status, "committed");
  } finally {
    await cleanup();
  }
});

test("Given a protected quote, when a candidate removes it, then commit is rejected", async () => {
  const { app, cleanup } = await fixture();
  try {
    const before = await (await app.request("/api/state")).json();
    const scene = before.scenes.find((item) => item.id === "scene-7");
    const quote = "The box seals a promise, not a ship";
    await post(app, `/api/scenes/${scene.id}/protect`, { quote });
    const candidate = await (await post(app, "/api/candidates", {
      sceneId: scene.id,
      instruction: "Remove the protected quote.",
      proposedText: scene.text.replace(quote, "The seal fell silent"),
      baseSnapshotId: before.head,
    })).json();
    const response = await post(app, `/api/candidates/${candidate.id}/commit`, {
      expectedHead: before.head, hash: candidate.hash,
    });
    assert.equal(response.status, 409);
    assert.equal((await response.json()).error.code, "PROTECTED_QUOTE");
  } finally {
    await cleanup();
  }
});

test("Given a completed commit, when an old snapshot is restored, then history advances without mutation", async () => {
  const { app, cleanup } = await fixture();
  try {
    const initial = await (await app.request("/api/state")).json();
    const scene = initial.scenes.find((item) => item.id === "scene-7");
    const candidate = await (await post(app, "/api/candidates", {
      sceneId: scene.id, instruction: "한 줄 추가", proposedText: `${scene.text}\n변화`,
      baseSnapshotId: initial.head,
    })).json();
    const committed = await (await post(app, `/api/candidates/${candidate.id}/commit`, {
      expectedHead: initial.head, hash: candidate.hash,
    })).json();
    const response = await post(app, "/api/restore", {
      snapshotId: initial.head, expectedHead: committed.head,
    });
    const restored = await response.json();
    assert.equal(response.status, 200);
    assert.notEqual(restored.head, initial.head);
    assert.equal(restored.scenes.find((item) => item.id === scene.id).text, scene.text);
  } finally {
    await cleanup();
  }
});

test("Given a reused idempotency key, when its body changes, then the API returns conflict", async () => {
  const { app, cleanup } = await fixture();
  try {
    const key = randomUUID();
    await post(app, "/api/plans", { title: "첫 계획", kind: "plot", description: "설명" }, key);
    const response = await post(app, "/api/plans", {
      title: "다른 계획", kind: "plot", description: "다른 설명",
    }, key);
    assert.equal(response.status, 409);
    assert.equal((await response.json()).error.code, "IDEMPOTENCY_MISMATCH");
  } finally {
    await cleanup();
  }
});
