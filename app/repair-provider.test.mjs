import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { branchFixture, command, readState } from './branch-test-support.mjs';
import { createApplicationWorker } from './execution.mjs';
import { workspaceHash } from '../packages/revision/workspace.mjs';

async function providerFixture(t, transform) {
  const fixture = await branchFixture(t);
  const requests = [];
  const server = createServer(async (request, response) => {
    let raw = '';
    for await (const chunk of request) raw += chunk;
    const body = JSON.parse(raw);
    requests.push(body);
    const input = JSON.parse(body.messages.find((message) => message.role === 'user').content);
    const patches = await transform(input);
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(patches) }, finish_reason: 'stop' }], usage: { completion_tokens: 40 } }));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const oldKey = process.env.OPENAI_API_KEY;
  const oldBase = process.env.OPENAI_BASE_URL;
  process.env.OPENAI_API_KEY = 'isolated-test-provider';
  process.env.OPENAI_BASE_URL = `http://127.0.0.1:${address.port}`;
  t.after(() => {
    server.close();
    if (oldKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = oldKey;
    if (oldBase === undefined) delete process.env.OPENAI_BASE_URL; else process.env.OPENAI_BASE_URL = oldBase;
  });
  const state = await readState(fixture.app);
  const input = { baseSnapshotId: state.head, baseWorkspaceHash: workspaceHash(await fixture.store.read()),
    instruction: '선택과 결과를 함께 보강', sceneIds: ['scene-1', 'scene-7'], planIds: ['plan-plot'], feedbackIds: [],
    budget: { maxModelCalls: 1, maxOutputTokens: 2048 } };
  return { ...fixture, state, input, requests, worker: createApplicationWorker(fixture.store) };
}

const completePatches = (input) => ({
  scenes: input.scenes.map((scene) => ({ id: scene.id, text: `${scene.text}\n새로운 결심이 남았다.` })),
  plans: input.plans.map((plan) => ({ id: plan.id, description: `${plan.description}\n선택의 결과를 확인한다.` })),
});

async function runRepair(fixture) {
  const response = await command(fixture.app, '/api/repair-runs', fixture.input, { branchId: fixture.state.currentBranchId });
  assert.equal(response.status, 202);
  const run = await response.json();
  await fixture.worker.tick();
  const state = await fixture.store.read();
  return { state, run: state.runs.find((item) => item.id === run.id) };
}

test('one provider call repairs exactly the selected scenes and plans while retaining metadata', async (t) => {
  const fixture = await providerFixture(t, completePatches);
  const { state, run } = await runRepair(fixture);
  assert.equal(fixture.requests.length, 1);
  assert.equal(fixture.requests[0].max_completion_tokens, 2048);
  assert.equal(run.actualOutputTokens, 40);
  const proposal = state.changeSets.find((item) => item.id === run.resultRef);
  assert.equal(proposal.entries.filter((entry) => entry.kind === 'scene').length, 2);
  const scene = proposal.entries.find((entry) => entry.artifactId === 'scene-7');
  assert.deepEqual(scene.after.protectedQuotes, fixture.state.scenes.find((item) => item.id === 'scene-7').protectedQuotes);
  assert.equal(scene.after.chapter, 7);
  assert.equal(state.head, fixture.state.head);
});

test('provider omissions are rejected and reported usage is retained', async (t) => {
  const fixture = await providerFixture(t, (input) => ({ ...completePatches(input), scenes: [] }));
  const { state, run } = await runRepair(fixture);
  assert.equal(run.state, 'failed');
  assert.equal(run.error.code, 'MODEL_SCOPE_MISMATCH');
  assert.equal(run.actualOutputTokens, 40);
  assert.equal(state.changeSets.length, 0);
});

test('provider duplicate IDs cannot substitute for the selected set', async (t) => {
  const fixture = await providerFixture(t, (input) => {
    const patches = completePatches(input);
    return { ...patches, scenes: [patches.scenes[0], patches.scenes[0]] };
  });
  const { run } = await runRepair(fixture);
  assert.equal(run.error.code, 'MODEL_SCOPE_MISMATCH');
});

test('context changes before execution prevent a provider call and release unused reservation', async (t) => {
  const fixture = await providerFixture(t, completePatches);
  const queued = await command(fixture.app, '/api/repair-runs', fixture.input, { branchId: fixture.state.currentBranchId });
  const run = await queued.json();
  await command(fixture.app, '/api/plans', { title: '새 계약', kind: 'constraints', description: '공개 조건 변경' }, { branchId: fixture.state.currentBranchId });
  await fixture.worker.tick();
  const failed = (await fixture.store.read()).runs.find((item) => item.id === run.id);
  assert.equal(fixture.requests.length, 0);
  assert.equal(failed.error.code, 'STALE_WORKSPACE');
  assert.equal(failed.reservedCalls, 0);
  assert.equal(failed.actualOutputTokens, 0);
});

test('generation finishing after a head change preserves a stale changeset rather than adopting it', { timeout: 5000 }, async (t) => {
  const started = Promise.withResolvers();
  const release = Promise.withResolvers();
  t.after(() => release.resolve());
  const fixture = await providerFixture(t, async (input) => { started.resolve(); await release.promise; return completePatches(input); });
  const queued = await command(fixture.app, '/api/repair-runs', fixture.input, { branchId: fixture.state.currentBranchId });
  const run = await queued.json();
  const ticking = fixture.worker.tick();
  await started.promise;
  const changed = await (await command(fixture.app, '/api/scenes', { title: '직접 쓴 장면', text: '사람이 추가한 원고' }, { branchId: fixture.state.currentBranchId })).json();
  release.resolve();
  await ticking;
  const state = await fixture.store.read();
  const completed = state.runs.find((item) => item.id === run.id);
  assert.equal(completed.state, 'awaiting_decision');
  assert.equal(state.head, changed.head);
  const proposal = state.changeSets.find((item) => item.id === completed.resultRef);
  assert.equal(proposal.baseSnapshotId, fixture.state.head);
  const visible = await (await fixture.app.request(`/api/change-sets/${proposal.id}`)).json();
  assert.equal(visible.canCommit, false);
  assert.ok(visible.blockedReasons.includes('STALE_HEAD'));
});

test('protected-quote violations remain inspectable invalid proposals, never canonical edits', async (t) => {
  const fixture = await providerFixture(t, (input) => ({
    scenes: input.scenes.map((scene) => ({ id: scene.id, text: '보호 문장을 지운 잘못된 출력' })),
    plans: completePatches(input).plans,
  }));
  const { state, run } = await runRepair(fixture);
  assert.equal(run.state, 'awaiting_decision');
  const proposal = state.changeSets.find((item) => item.id === run.resultRef);
  assert.ok(proposal.issues.some((issue) => issue.code === 'PROTECTED_QUOTE'));
  assert.equal(state.head, fixture.state.head);
});
