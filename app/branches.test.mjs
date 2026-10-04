import assert from "node:assert/strict";
import test from "node:test";

import { branchFixture, command, createBranch, readState, switchBranch } from "./branch-test-support.mjs";

const scene = (state, id = "scene-7") => state.scenes.find((item) => item.id === id);

test("Given one branch, when a branch is created, then it shares the snapshot catalog without switching or copying payloads", async (t) => {
  const { app, store } = await branchFixture(t);
  const before = await readState(app);

  const { response, branch } = await createBranch(app, before, "두 번째 길");
  const after = await readState(app);
  const stored = await store.read();

  assert.equal(response.status, 201);
  assert.equal(after.currentBranchId, before.currentBranchId);
  assert.equal(after.head, before.head);
  assert.deepEqual(Object.keys(branch).sort(), ["createdAt", "headSnapshotId", "id", "isCurrent", "name", "snapshotCount", "sourceBranchId", "sourceSnapshotId"].sort());
  assert.equal(branch.isCurrent, false);
  assert.equal(branch.sourceBranchId, before.currentBranchId);
  assert.equal(branch.headSnapshotId, before.head);
  assert.equal(stored.snapshots.length, before.snapshots.length);
  assert.equal(after.snapshots.every((snapshot) => snapshot.canBranch === true), true);
});

test("Given a saved draft, when a branch is forked and switched, then uncommitted and branch-local context does not cross", async (t) => {
  const { app } = await branchFixture(t);
  const main = await readState(app);
  await command(app, "/api/scenes/scene-7/draft", { text: "main 전용 초고", baseSnapshotId: main.head }, { branchId: main.currentBranchId });
  const { branch } = await createBranch(app, main, "격리 분기");

  const missingHeader = await command(app, "/api/plans", { title: "헤더 없음", kind: "plot", description: "거부" });
  await switchBranch(app, await readState(app), branch.id);
  const fork = await readState(app);
  await command(app, "/api/plans", { title: "분기 계획", kind: "plot", description: "분기 전용" }, { branchId: branch.id });
  await command(app, "/api/scenes/scene-7/protect", { quote: "리라는 젖은 장갑" }, { branchId: branch.id });
  await command(app, "/api/feedback", { sceneId: "scene-7", text: "분기 피드백", scope: "scene" }, { branchId: branch.id });
  await switchBranch(app, await readState(app), main.currentBranchId);
  const returned = await readState(app);

  assert.equal(missingHeader.status, 409);
  assert.equal((await missingHeader.json()).error.code, "BRANCH_REQUIRED");
  assert.equal(fork.drafts["scene-7"], undefined);
  assert.equal(returned.drafts["scene-7"].text, "main 전용 초고");
  assert.equal(returned.plans.some((plan) => plan.title === "분기 계획"), false);
  assert.equal(scene(returned).protectedQuotes.includes("리라는 젖은 장갑"), false);
  assert.equal(returned.feedback.some((item) => item.text === "분기 피드백"), false);
});

test("Given two branches at the same head, when identical candidates are proposed, then identity and stale branch guards stay branch-specific", async (t) => {
  const { app } = await branchFixture(t);
  const main = await readState(app);
  const { branch } = await createBranch(app, main, "후보 분기");
  const input = { sceneId: "scene-7", instruction: "같은 수정", proposedText: `${scene(main).text}\n분기 문장`, baseSnapshotId: main.head };
  const candidateA = await (await command(app, "/api/candidates", input, { branchId: main.currentBranchId })).json();
  await switchBranch(app, await readState(app), branch.id);
  const candidateB = await (await command(app, "/api/candidates", input, { branchId: branch.id })).json();
  const stale = await command(app, "/api/plans", { title: "잘못된 분기", kind: "plot", description: "거부" }, { branchId: main.currentBranchId });

  assert.equal(candidateA.branchId, main.currentBranchId);
  assert.equal(candidateB.branchId, branch.id);
  assert.notEqual(candidateA.hash, candidateB.hash);
  assert.equal(stale.status, 409);
});

test("Given a fork, when its candidate advances, then main text stays unchanged and its snapshot cannot be exported from main", async (t) => {
  const { app } = await branchFixture(t);
  const main = await readState(app);
  const original = scene(main).text;
  const { branch } = await createBranch(app, main, "갈라진 결말");
  await switchBranch(app, main, branch.id);
  const fork = await readState(app);
  const candidate = await (await command(app, "/api/candidates", {
    sceneId: "scene-7", instruction: "분기 결말", proposedText: `${original}\nB에서만 변한다.`, baseSnapshotId: fork.head,
  }, { branchId: branch.id })).json();
  const committed = await (await command(app, `/api/candidates/${candidate.id}/commit`, {
    expectedHead: fork.head, hash: candidate.hash,
  }, { branchId: branch.id })).json();
  await switchBranch(app, await readState(app), main.currentBranchId);
  const returned = await readState(app);

  assert.equal(scene(returned).text, original);
  assert.equal(returned.head, main.head);
  assert.equal((await app.request(`/api/export?snapshotId=${committed.head}`)).status, 404);
});

test("Given snapshot-bound context, when a historical branch is created, then it restores context from that snapshot", async (t) => {
  const { app } = await branchFixture(t);
  const main = await readState(app);
  await command(app, "/api/plans", { title: "옛 계획", kind: "plot", description: "옛 맥락" }, { branchId: main.currentBranchId });
  const snapshotted = await (await command(app, "/api/scenes", { title: "맥락 기준", text: "기준 장면" }, { branchId: main.currentBranchId })).json();
  await command(app, "/api/plans", { title: "새 계획", kind: "plot", description: "새 맥락" }, { branchId: main.currentBranchId });
  await command(app, "/api/scenes", { title: "다음 기준", text: "이후 장면" }, { branchId: main.currentBranchId });
  const current = await readState(app);
  const { response, branch } = await createBranch(app, current, "과거 맥락", snapshotted.head);
  await switchBranch(app, current, branch.id);
  const historical = await readState(app);

  assert.equal(response.status, 201);
  assert.equal(historical.plans.some((plan) => plan.title === "옛 계획"), true);
  assert.equal(historical.plans.some((plan) => plan.title === "새 계획"), false);
  assert.equal(historical.scenes.some((item) => item.title === "다음 기준"), false);
});

test("Given a project edition, when another branch is active, then the frozen edition remains project-wide and unchanged", async (t) => {
  const { app } = await branchFixture(t);
  const main = await readState(app);
  const preview = await (await app.request(`/api/export-preview?snapshotId=${main.head}`)).json();
  const edition = await (await command(app, "/api/editions", {
    title: "공유 판본", snapshotId: main.head, expectedHead: main.head, approvedManifestHash: preview.manifestHash,
    revisionOf: null, approvedPreviousManifestHash: null, decision: "publish", policyVersion: 1,
  }, { branchId: main.currentBranchId })).json();
  const frozen = await (await app.request(`/api/editions/${edition.id}/export`)).text();
  const { branch } = await createBranch(app, await readState(app), "판본 공유");
  await switchBranch(app, await readState(app), branch.id);

  const response = await app.request(`/api/editions/${edition.id}/export`);
  assert.equal(response.status, 200);
  assert.equal(await response.text(), frozen);
});

test("Given queued and terminal run records, when branches switch, then active work blocks switching and completed queue history returns", async (t) => {
  const { app, store } = await branchFixture(t);
  const main = await readState(app);
  const { branch } = await createBranch(app, main, "실행 격리");
  const run = await (await command(app, "/api/runs", {
    sceneId: "scene-7", instruction: "실행 격리", baseSnapshotId: main.head,
    budget: { maxModelCalls: 1, maxOutputTokens: 100 },
  }, { branchId: main.currentBranchId })).json();
  const blocked = await switchBranch(app, await readState(app), branch.id);
  await command(app, `/api/runs/${run.id}/cancel`, {}, { branchId: main.currentBranchId });
  await switchBranch(app, await readState(app), branch.id);
  assert.equal((await readState(app)).runs.length, 0);
  await switchBranch(app, await readState(app), main.currentBranchId);
  const restored = await store.read();

  assert.equal(blocked.status, 409);
  assert.equal(restored.runs.some((item) => item.id === run.id && item.state === "cancelled"), true);
  assert.equal(restored.jobs.some((job) => job.runId === run.id), true);
  assert.equal(restored.runEvents.some((event) => event.runId === run.id), true);
});

test("Given branch commands, when expectations, names, or idempotency origins conflict, then unsafe reuse is rejected", async (t) => {
  const { app } = await branchFixture(t);
  const main = await readState(app);
  const { branch } = await createBranch(app, main, "고유 이름");
  const duplicate = await createBranch(app, await readState(app), "고유 이름");
  const staleCreate = await command(app, "/api/branches", {
    name: "오래된 요청", sourceSnapshotId: main.head, expectedBranchId: main.currentBranchId, expectedHead: "missing-head",
  }, { branchId: main.currentBranchId });
  const key = crypto.randomUUID();
  const first = await switchBranch(app, await readState(app), branch.id, { key });
  const replay = await switchBranch(app, main, branch.id, { key });
  const crossBranch = await switchBranch(app, await readState(app), main.currentBranchId, { key });

  assert.equal(duplicate.response.status, 409);
  assert.equal(staleCreate.status, 409);
  assert.equal(first.status, 200);
  assert.equal(replay.status, 200);
  assert.equal(crossBranch.status, 409);
});
