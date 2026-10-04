import assert from 'node:assert/strict';
import test from 'node:test';
import { branchFixture, command, readState } from './branch-test-support.mjs';

async function createRequest(t, kind) {
  const fixture = await branchFixture(t);
  const state = await readState(fixture.app);
  const path = kind === 'run' ? '/api/runs' : '/api/plans';
  const body = kind === 'run'
    ? { sceneId: 'scene-7', instruction: '멱등성 확인', baseSnapshotId: state.head }
    : { title: '원래 작품의 계획', kind: 'plot', description: '같은 본문' };
  const key = crypto.randomUUID();
  const response = await command(fixture.app, path, body, { key });
  const result = await response.json();
  return { ...fixture, state, path, body, key, result, status: response.status };
}

for (const kind of ['plan', 'run']) {
  test(`${kind}: a new implicit request replays only in the same project and branch`, async (t) => {
    const { app, path, body, key, result, status } = await createRequest(t, kind);
    const replay = await command(app, path, body, { key });
    assert.equal(replay.status, status);
    assert.equal((await replay.json()).id, result.id);
  });

  test(`${kind}: a new implicit record cannot replay after switching projects`, async (t) => {
    const { app, path, body, key, result } = await createRequest(t, kind);
    if (kind === 'run') await command(app, `/api/runs/${result.id}/cancel`, {});
    await command(app, '/api/projects', { title: '새 작품', direction: '다른 요청 범위' });
    const replay = await command(app, path, body, { key });
    assert.equal(replay.status, 409);
    assert.equal((await replay.json()).error.code, 'IDEMPOTENCY_SCOPE_MISMATCH');
    const state = await readState(app);
    assert.equal(state.plans.length, 0);
    assert.equal(state.runs.length, 0);
  });

  test(`${kind}: truly legacy scope-less records remain replayable in single-branch compatibility mode`, async (t) => {
    const { app, store, path, body, key, result, status } = await createRequest(t, kind);
    await store.transaction((state) => {
      delete state.idempotency[key].projectId;
      delete state.idempotency[key].branchId;
      delete state.idempotency[key].scopeExplicit;
      delete state.idempotency[key].result.branchId;
    });
    const replay = await command(app, path, body, { key });
    assert.equal(replay.status, status);
    assert.equal((await replay.json()).id, result.id);
  });

  test(`${kind}: explicit scope is not invented for legacy unscoped records`, async (t) => {
    const { app, store, path, body, key, state } = await createRequest(t, kind);
    await store.transaction((saved) => {
      delete saved.idempotency[key].projectId;
      delete saved.idempotency[key].branchId;
      delete saved.idempotency[key].scopeExplicit;
    });
    const replay = await command(app, path, body, { key, branchId: state.currentBranchId });
    assert.equal(replay.status, 409);
    assert.equal((await replay.json()).error.code, 'IDEMPOTENCY_SCOPE_MISMATCH');
  });
}
