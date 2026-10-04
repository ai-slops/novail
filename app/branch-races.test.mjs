import assert from 'node:assert/strict';
import test from 'node:test';
import { createApp } from './api.mjs';
import { addCandidate } from './domain.mjs';
import { createWorker } from '../packages/execution/worker.mjs';
import { branchFixture, command, createBranch, readState, switchBranch } from './branch-test-support.mjs';

test('a branch switch between preflight and transaction rejects the delayed write even at the same head', { timeout: 5000 }, async (t) => {
  const { app, store } = await branchFixture(t);
  const main = await readState(app);
  const { branch } = await createBranch(app, main, '경쟁 분기');
  const entered = Promise.withResolvers();
  const release = Promise.withResolvers();
  t.after(() => release.resolve());
  const delayedApp = createApp({ store: {
    read: () => store.read(),
    transaction: async (operation) => { entered.resolve(); await release.promise; return store.transaction(operation); },
  } });
  const pending = command(delayedApp, '/api/scenes/scene-7/draft', { text: '늦은 쓰기', baseSnapshotId: main.head }, { branchId: main.currentBranchId });
  await entered.promise;
  assert.equal((await switchBranch(app, main, branch.id)).status, 200);
  release.resolve();
  const response = await pending;
  assert.equal(response.status, 409);
  assert.equal((await response.json()).error.code, 'BRANCH_MISMATCH');
  assert.equal((await readState(app)).drafts['scene-7'], undefined);
});

test('identical request bodies cannot replay another branch idempotency record', async (t) => {
  const { app } = await branchFixture(t);
  const main = await readState(app);
  const { branch } = await createBranch(app, main, '멱등 분기');
  const body = { title: 'A에서만 추가', kind: 'plot', description: '같은 요청 본문' };
  const key = crypto.randomUUID();
  assert.equal((await command(app, '/api/plans', body, { key, branchId: main.currentBranchId })).status, 201);
  await switchBranch(app, await readState(app), branch.id);
  const replay = await command(app, '/api/plans', body, { key, branchId: branch.id });
  assert.equal(replay.status, 409);
  assert.equal((await replay.json()).error.code, 'IDEMPOTENCY_SCOPE_MISMATCH');
  assert.equal((await readState(app)).plans.some((plan) => plan.title === body.title), false);
});

test('a candidate from a sibling branch cannot be committed or rejected through the active branch', async (t) => {
  const { app } = await branchFixture(t);
  const main = await readState(app);
  const { branch } = await createBranch(app, main, '후보 소유권');
  const candidate = await (await command(app, '/api/candidates', { sceneId: 'scene-7', instruction: '수정',
    proposedText: main.scenes.find((scene) => scene.id === 'scene-7').text, baseSnapshotId: main.head }, { branchId: main.currentBranchId })).json();
  await switchBranch(app, main, branch.id);
  assert.equal((await command(app, `/api/candidates/${candidate.id}/commit`, { expectedHead: main.head, hash: candidate.hash }, { branchId: branch.id })).status, 404);
  assert.equal((await command(app, `/api/candidates/${candidate.id}/reject`, {}, { branchId: branch.id })).status, 404);
  await switchBranch(app, await readState(app), main.currentBranchId);
  assert.equal((await readState(app)).candidates.find((item) => item.id === candidate.id).status, 'pending');
});

test('late cancelled worker output cannot finalize in the newly selected branch', { timeout: 5000 }, async (t) => {
  const { app, store } = await branchFixture(t);
  const main = await readState(app);
  const { branch } = await createBranch(app, main, '늦은 응답');
  const started = Promise.withResolvers();
  const finish = Promise.withResolvers();
  t.after(() => finish.resolve({ text: '늦은 결과' }));
  let finalized = false;
  const worker = createWorker({ store,
    execute: async () => { started.resolve(); return finish.promise; },
    finalize: (state, run, payload) => {
      finalized = true;
      return addCandidate(state, { input: { sceneId: run.sceneId, instruction: run.instruction, baseSnapshotId: run.baseSnapshotId }, proposedText: payload.text, adapterLabel: 'test', branchId: run.branchId });
    },
  });
  const run = await (await command(app, '/api/runs', { sceneId: 'scene-7', instruction: '실행', baseSnapshotId: main.head }, { branchId: main.currentBranchId })).json();
  const ticking = worker.tick();
  await started.promise;
  assert.equal((await switchBranch(app, main, branch.id)).status, 409);
  await command(app, `/api/runs/${run.id}/cancel`, {}, { branchId: main.currentBranchId });
  await switchBranch(app, main, branch.id);
  finish.resolve({ text: '다른 분기에 반영되면 안 되는 원고' });
  await ticking;
  assert.equal(finalized, false);
  assert.equal((await readState(app)).candidates.length, 0);
  assert.equal((await app.request(`/api/runs/${run.id}`)).status, 404);
  await switchBranch(app, await readState(app), main.currentBranchId);
  assert.equal((await readState(app)).runs.find((item) => item.id === run.id).state, 'cancelled');
});

test('project round trips preserve both branch workspaces and the selected branch pointer', async (t) => {
  const { app, store } = await branchFixture(t);
  const main = await readState(app);
  await command(app, '/api/scenes/scene-7/draft', { text: 'A 초고', baseSnapshotId: main.head }, { branchId: main.currentBranchId });
  const { branch } = await createBranch(app, main, '보관 분기');
  await switchBranch(app, main, branch.id);
  await command(app, '/api/scenes/scene-7/draft', { text: 'B 초고', baseSnapshotId: main.head }, { branchId: branch.id });
  const changed = await (await command(app, '/api/scenes', { title: 'B 장면', text: 'B만의 원고' }, { branchId: branch.id })).json();
  await command(app, '/api/projects', { title: '다른 작품', direction: '새 작품' }, { branchId: branch.id });
  const other = await readState(app);
  await command(app, `/api/projects/${main.project.id}/switch`, {}, { branchId: other.currentBranchId });
  const restored = await readState(app);
  assert.equal(restored.currentBranchId, branch.id);
  assert.equal(restored.head, changed.head);
  assert.equal(restored.drafts['scene-7'].text, 'B 초고');
  await switchBranch(app, restored, main.currentBranchId);
  const returned = await readState(app);
  assert.equal(returned.drafts['scene-7'].text, 'A 초고');
  assert.equal(returned.snapshots.some((snapshot) => snapshot.id === changed.head), false);
  assert.equal((await store.read()).snapshots.some((snapshot) => snapshot.id === changed.head), true);
});

test('explicit read scope rejects stale snapshot downloads even when branch heads are shared', async (t) => {
  const { app } = await branchFixture(t);
  const main = await readState(app);
  const { branch } = await createBranch(app, main, '조회 범위');
  await switchBranch(app, main, branch.id);
  const response = await app.request(`/api/export?snapshotId=${main.head}&branchId=${main.currentBranchId}`);
  assert.equal(response.status, 409);
  assert.equal((await response.json()).error.code, 'BRANCH_MISMATCH');
});
