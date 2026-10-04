import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createApp } from "./api.mjs";
import { addCandidate } from "./domain.mjs";
import { FileStore } from "./store.mjs";

const fixture = async () => {
  const directory = await mkdtemp(join(tmpdir(), "novail-hardening-"));
  const store = new FileStore(join(directory, "state.json"));
  await store.initialize();
  return { store, app: createApp({ store, distRoot: directory }), cleanup: () => rm(directory, { recursive: true, force: true }) };
};

const post = (app, path, body, headers = {}) => app.request(path, {
  method: "POST",
  headers: { "content-type": "application/json", "idempotency-key": randomUUID(), ...headers },
  body: JSON.stringify(body),
});

test("Given editor state, when read aliases are requested, then focused resources are returned", async () => {
  const { app, cleanup } = await fixture();
  try {
    const scenes = await (await app.request("/api/scenes")).json();
    const plans = await (await app.request("/api/plans")).json();
    const project = await (await app.request("/api/projects/project-blue-seal")).json();
    assert.equal(scenes.length, 7);
    assert.equal(plans.length, 4);
    assert.equal(project.title, "푸른 인장의 밤");
  } finally {
    await cleanup();
  }
});

test("Given an unknown API route, when requested, then a JSON not-found error is returned", async () => {
  const { app, cleanup } = await fixture();
  try {
    const response = await app.request("/api/does-not-exist");
    assert.equal(response.status, 404);
    assert.equal((await response.json()).error.code, "NOT_FOUND");
  } finally {
    await cleanup();
  }
});

test("Given APP_TOKEN, when a cross-origin mutation lacks authorization, then it is rejected", async () => {
  const previous = process.env.APP_TOKEN;
  process.env.APP_TOKEN = "test-secret";
  const { app, cleanup } = await fixture();
  try {
    const rejected = await post(app, "/api/plans", { title: "차단", kind: "plot", description: "차단" }, { origin: "https://evil.example" });
    const accepted = await post(app, "/api/plans", { title: "허용", kind: "plot", description: "허용" }, {
      origin: "https://editor.example", host: "editor.example", authorization: "Bearer test-secret",
    });
    assert.equal(rejected.status, 401);
    assert.equal(accepted.status, 201);
  } finally {
    if (previous === undefined) delete process.env.APP_TOKEN;
    else process.env.APP_TOKEN = previous;
    await cleanup();
  }
});

test("Given a draft newer than base, when demo generation runs, then it uses exact snapshot text", async () => {
  const { app, cleanup } = await fixture();
  try {
    const state = await (await app.request("/api/state")).json();
    const canonical = state.scenes.find((scene) => scene.id === "scene-7").text;
    await post(app, "/api/scenes/scene-7/draft", { text: "기준이 아닌 최신 초고", baseSnapshotId: state.head });
    const response = await post(app, "/api/candidates", {
      sceneId: "scene-7", instruction: "결말을 조정", baseSnapshotId: state.head,
    });
    const candidate = await response.json();
    assert.equal(candidate.before, canonical);
    assert.equal(candidate.after.includes("기준이 아닌 최신 초고"), false);
    assert.notEqual(candidate.after, canonical);
  } finally {
    await cleanup();
  }
});

test("Given a cancelled run candidate, when commit is requested, then approval is blocked", async () => {
  const { app, store, cleanup } = await fixture();
  try {
    const candidate = await store.transaction((state) => {
      state.runs.push({ id: "run-cancelled", state: "cancelled", purpose: "revise_scene", createdAt: new Date().toISOString() });
      return addCandidate(state, {
        input: { sceneId: "scene-7", instruction: "실행 후보", baseSnapshotId: state.head },
        proposedText: state.scenes.find((scene) => scene.id === "scene-7").text,
        adapterLabel: "test",
        runId: "run-cancelled",
      });
    });
    const response = await post(app, `/api/candidates/${candidate.id}/commit`, {
      expectedHead: candidate.baseSnapshotId, hash: candidate.hash,
    });
    assert.equal(response.status, 409);
    assert.equal((await response.json()).error.code, "RUN_CANCELLED");
  } finally {
    await cleanup();
  }
});

test("Given narrative checks, when readonly helper endpoints are posted, then typed verdicts are returned without idempotency", async () => {
  const { app, cleanup } = await fixture();
  try {
    const readiness = await app.request("/api/readiness", {
      method: "POST", headers: { "content-type": "application/json", origin: "https://review.example" },
      body: JSON.stringify({ generationKind: "draft", baseSnapshotId: "snapshot-initial", openDecisions: [], conditions: [], requiredTokens: 100, tokenBudget: 200 }),
    });
    const evidence = await app.request("/api/evidence/validate", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "A🌊항구", startCp: 2, endCp: 4, quote: "항구" }),
    });
    const timeline = await app.request("/api/timeline/check", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ edges: [
        { id: "a", from: "s1", to: "s2", relation: "before" },
        { id: "b", from: "s2", to: "s1", relation: "before" },
      ] }),
    });
    assert.equal((await readiness.json()).ready, true);
    assert.equal((await evidence.json()).valid, true);
    assert.equal((await timeline.json()).verdict, "fail");
  } finally {
    await cleanup();
  }
});

test("Given local demo generation, when a candidate is created, then prose stays clean and context is hashed", async () => {
  const { app, cleanup } = await fixture();
  try {
    const state = await (await app.request("/api/state")).json();
    const scene = state.scenes.find((item) => item.id === "scene-7");
    const candidate = await (await post(app, "/api/candidates", {
      sceneId: scene.id, instruction: "리라의 동기를 강화", baseSnapshotId: state.head,
    })).json();
    assert.equal(candidate.after.includes("[편집 메모"), false);
    assert.equal(candidate.after.includes(scene.protectedQuotes[0]), true);
    assert.match(candidate.contextHash, /^[a-f0-9]{64}$/);
  } finally {
    await cleanup();
  }
});

test("Given cancellation was requested after generation, when commit is requested, then approval is blocked", async () => {
  const { app, store, cleanup } = await fixture();
  try {
    const candidate = await store.transaction((state) => {
      state.runs.push({ id: "run-cancelling", state: "awaiting_decision", cancellationRequested: true, purpose: "revise_scene", createdAt: new Date().toISOString() });
      return addCandidate(state, {
        input: { sceneId: "scene-7", instruction: "실행 후보", baseSnapshotId: state.head },
        proposedText: state.scenes.find((scene) => scene.id === "scene-7").text,
        adapterLabel: "test", runId: "run-cancelling",
      });
    });
    const response = await post(app, `/api/candidates/${candidate.id}/commit`, {
      expectedHead: candidate.baseSnapshotId, hash: candidate.hash,
    });
    assert.equal(response.status, 409);
    assert.equal((await response.json()).error.code, "RUN_CANCELLED");
  } finally {
    await cleanup();
  }
});
