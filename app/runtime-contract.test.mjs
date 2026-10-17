import assert from 'node:assert/strict';
import test from 'node:test';
import { branchFixture, command, readState } from './branch-test-support.mjs';
import { workspaceHash } from '../packages/revision/workspace.mjs';
import { createApplicationWorker } from './execution.mjs';
import { publicRuntimeEventSchema } from '../packages/execution/contracts.ts';
import { safeRunEvent } from '../packages/execution/public-contract.mjs';

test('runtime info exposes the stable part contract without provider configuration', async (t) => {
  const previousKey = process.env.OPENAI_API_KEY;
  const previousBase = process.env.OPENAI_BASE_URL;
  const previousModel = process.env.OPENAI_MODEL;
  process.env.OPENAI_API_KEY = 'runtime-secret';
  process.env.OPENAI_BASE_URL = 'https://provider.invalid/private';
  process.env.OPENAI_MODEL = '';
  t.after(() => {
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = previousKey;
    if (previousBase === undefined) delete process.env.OPENAI_BASE_URL; else process.env.OPENAI_BASE_URL = previousBase;
    if (previousModel === undefined) delete process.env.OPENAI_MODEL; else process.env.OPENAI_MODEL = previousModel;
  });
  const { app } = await branchFixture(t);

  const response = await app.request('/api/runtime-info');
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(body.readOnlyToolIds, [
    'novail_read_selected_scenes',
    'novail_read_selected_plans',
    'novail_read_readonly_context',
  ]);
  assert.equal(body.runtime, 'part');
  assert.equal(body.partVersion, '0.1.0');
  assert.equal(body.mode, 'openai-compatible');
  assert.equal(body.nonAI, false);
  assert.deepEqual(body.model, { label: '실행할 모델을 선택하세요', defaultModel: null });
  assert.equal(body.publicBudget.defaults.maxModelCalls, 4);
  assert.equal(JSON.stringify(body).includes('runtime-secret'), false);
  assert.equal(JSON.stringify(body).includes('provider.invalid'), false);
});

test('legacy dotted tool events are normalized into the current public event contract', () => {
  const legacy = { id: 'legacy-tool', runId: 'legacy-run', sequence: 1,
    type: 'runtime.tool.completed', details: { toolId: 'novail.read_selected_scenes', outcome: 'completed' },
    createdAt: '2026-01-01T00:00:00.000Z' };
  const projected = safeRunEvent(legacy);

  assert.deepEqual(publicRuntimeEventSchema.parse(legacy), legacy);
  assert.equal(projected.details.toolId, 'novail_read_selected_scenes');
  assert.deepEqual(publicRuntimeEventSchema.parse(projected), projected);
});

test('run HTTP responses and public state exclude frozen inputs and lease credentials', async (t) => {
  const { app, store } = await branchFixture(t);
  const state = await readState(app);
  const created = await command(app, '/api/repair-runs', {
    baseSnapshotId: state.head,
    baseWorkspaceHash: workspaceHash(await store.read()),
    instruction: '안전한 공개 계약 확인',
    sceneIds: ['scene-1'],
    planIds: [],
  }, { branchId: state.currentBranchId });
  const run = await created.json();
  await createApplicationWorker(store).tick();

  const detailResponse = await app.request(`/api/runs/${run.id}`, {
    headers: { 'X-Novail-Branch-Id': state.currentBranchId },
  });
  const detail = await detailResponse.json();
  const events = await (await app.request(`/api/runs/${run.id}/events`, {
    headers: { 'X-Novail-Branch-Id': state.currentBranchId },
  })).text();
  const publicState = await readState(app);
  const serialized = JSON.stringify({ created: run, detail, runs: publicState.runs });

  assert.equal(created.status, 202);
  assert.equal(detail.id, run.id);
  assert.equal(serialized.includes('inputWorkspace'), false);
  assert.equal(serialized.includes('leaseToken'), false);
  assert.equal(serialized.includes('leaseUntil'), false);
  assert.equal(serialized.includes('protectedQuotes'), false);
  assert.deepEqual(detail.runtime, {
    name: 'part', version: '0.1.0', mode: 'local-demo', modelLabel: '로컬 예제 · AI 생성 아님 · part fakeModel',
  });
  const started = JSON.parse(events.split('\n').find((line) => line.startsWith('data: ') && line.includes('runtime.started')).slice(6));
  assert.deepEqual(started.details.runtime, detail.runtime);
});

test('persisted legacy execution records project to the stable public run contract', async (t) => {
  const { app, store } = await branchFixture(t);
  const state = await readState(app);
  await store.transaction((working) => {
    working.runs.push({ id: 'legacy-run', projectId: working.project.id, state: 'completed', queueManaged: true });
    working.jobs.push({ id: 'legacy-job', runId: 'legacy-run', state: 'succeeded' });
  });

  const response = await app.request('/api/runs/legacy-run', {
    headers: { 'X-Novail-Branch-Id': state.currentBranchId },
  });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.purpose, 'legacy');
  assert.equal(body.baseSnapshotId, '');
  assert.equal(body.createdAt, '');
  assert.equal(body.jobs[0].attempt, 0);
});
