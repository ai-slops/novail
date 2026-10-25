import assert from 'node:assert/strict';
import test from 'node:test';
import { command } from './branch-test-support.mjs';
import { completePatches, providerFixture, runRepair, TOOL_IDS } from './repair-provider-test-support.mjs';

test('one provider call repairs exactly the selected scenes and plans while retaining metadata', async (t) => {
  const fixture = await providerFixture(t, completePatches);
  const { state, run } = await runRepair(fixture);
  assert.equal(fixture.requests.length, 2);
  assert.equal(fixture.requests[0].max_completion_tokens, 2048);
  assert.equal(fixture.requests[0].model, 'selected-model');
  assert.equal(fixture.requests[0].stream, true);
  assert.equal(fixture.requests[0].response_format.type, 'json_schema');
  assert.equal(fixture.requests[0].response_format.json_schema.strict, true);
  const outputSchema = fixture.requests[0].response_format.json_schema.schema;
  assert.equal(outputSchema.additionalProperties, false);
  assert.deepEqual(outputSchema.required, ['scenes', 'plans']);
  assert.deepEqual(outputSchema.properties.scenes.items.properties.id.enum, fixture.input.sceneIds);
  assert.deepEqual(outputSchema.properties.plans.items.properties.id.enum, fixture.input.planIds);
  assert.equal('prefixItems' in outputSchema.properties.scenes, false);
  assert.equal(outputSchema.properties.scenes.items.additionalProperties, false);
  assert.deepEqual(fixture.requests[0].tools.map((tool) => tool.function.name), TOOL_IDS);
  assert.equal(fixture.requests[0].tools.every((tool) => /^[a-zA-Z0-9_-]{1,64}$/.test(tool.function.name)), true);
  assert.equal(run.actualOutputTokens, 40);
  assert.equal(run.model, 'selected-model');
  assert.equal(run.runtime.modelLabel, 'OpenAI-compatible provider · selected-model');
  const proposal = state.changeSets.find((item) => item.id === run.resultRef);
  assert.equal(proposal.entries.filter((entry) => entry.kind === 'scene').length, 2);
  const scene = proposal.entries.find((entry) => entry.artifactId === 'scene-7');
  assert.deepEqual(scene.after.protectedQuotes, fixture.state.scenes.find((item) => item.id === 'scene-7').protectedQuotes);
  assert.equal(scene.after.chapter, 7);
  assert.equal(state.head, fixture.state.head);
});

test('a configured provider rejects a missing model before reserving or invoking work', async (t) => {
  const fixture = await providerFixture(t, completePatches);
  const { model: _model, ...input } = fixture.input;
  process.env.OPENAI_MODEL = '';

  const response = await command(fixture.app, '/api/repair-runs', input, { branchId: fixture.state.currentBranchId });
  const body = await response.json();
  const state = await fixture.store.read();

  assert.equal(response.status, 422);
  assert.equal(body.error.code, 'MODEL_REQUIRED');
  assert.equal(fixture.requests.length, 0);
  assert.equal(state.runs.length, 0);
  assert.equal(state.jobs.length, 0);
});

test('an invalid model id is rejected at the HTTP boundary before queueing work', async (t) => {
  const fixture = await providerFixture(t, completePatches);

  const response = await command(fixture.app, '/api/repair-runs', {
    ...fixture.input,
    model: 'x'.repeat(201),
  }, { branchId: fixture.state.currentBranchId });
  const state = await fixture.store.read();

  assert.equal(response.status, 400);
  assert.equal(fixture.requests.length, 0);
  assert.equal(state.runs.length, 0);
  assert.equal(state.jobs.length, 0);
});

test('the queued model remains immutable when the environment default changes before execution', async (t) => {
  const fixture = await providerFixture(t, completePatches, { model: 'queued-model' });
  const queued = await command(fixture.app, '/api/repair-runs', fixture.input, { branchId: fixture.state.currentBranchId });
  assert.equal(queued.status, 202);
  const queuedRun = await queued.json();
  assert.equal(queuedRun.selectedModel, 'queued-model');
  process.env.OPENAI_MODEL = 'later-default';

  await fixture.worker.tick();
  const run = (await fixture.store.read()).runs.find((item) => item.id === queuedRun.id);

  assert.equal(fixture.requests[0].model, 'queued-model');
  assert.equal(run.model, 'queued-model');
});

test('a provider invocation is rejected before transport when the full encoded output ceiling no longer fits', async (t) => {
  const fixture = await providerFixture(t, completePatches, {
    firstCompletionTokens: 1800,
    budget: { maxModelCalls: 2, maxOutputTokens: 2048, maxOutputTokensPerInvocation: 2048 },
  });
  const { run } = await runRepair(fixture);

  assert.equal(fixture.requests.length, 1);
  assert.equal(fixture.requests[0].max_completion_tokens, 2048);
  assert.equal(run.state, 'failed');
  assert.equal(run.error.code, 'part.BUDGET_EXCEEDED');
  assert.equal(run.actualOutputTokens, 1800);
  assert.equal(run.reservedOutputTokens, 0);
});

test('provider usage beyond the durable known-token ceiling is recorded before the run fails', async (t) => {
  const fixture = await providerFixture(t, completePatches, {
    finalPromptTokens: 100,
    finalCompletionTokens: 40,
    budget: { maxModelCalls: 2, maxKnownTokens: 140, maxOutputTokens: 100, maxOutputTokensPerInvocation: 100 },
  });
  const { state, run } = await runRepair(fixture);

  assert.equal(fixture.requests.length, 2);
  assert.equal(run.state, 'failed');
  assert.equal(run.error.code, 'BUDGET_EXCEEDED');
  assert.equal(run.actualKnownTokens, 150);
  assert.equal(run.actualOutputTokens, 40);
  assert.equal(state.changeSets.some((item) => item.runId === run.id), false);
});

test('an empty selected collection does not emit an invalid empty enum', async (t) => {
  const fixture = await providerFixture(t, completePatches, { planIds: [] });
  const { run } = await runRepair(fixture);
  const plans = fixture.requests[0].response_format.json_schema.schema.properties.plans;

  assert.equal(plans.maxItems, 0);
  assert.equal('enum' in plans.items.properties.id, false);
  assert.equal(run.state, 'awaiting_decision');
});

test('a tool response without usage consumes its reserved output ceiling before another model call', async (t) => {
  const fixture = await providerFixture(t, completePatches, {
    omitToolUsage: true,
    budget: { maxModelCalls: 2, maxKnownTokens: 100, maxOutputTokens: 100, maxOutputTokensPerInvocation: 100 },
  });
  const { run } = await runRepair(fixture);

  assert.equal(fixture.requests.length, 1);
  assert.equal(run.state, 'failed');
  assert.equal(run.error.code, 'part.BUDGET_EXCEEDED');
  assert.equal(run.actualOutputTokens, 100);
  assert.equal(run.actualKnownTokens, 100);
});

test('the basic driver honors the public model-call limit above its former default', async (t) => {
  const fixture = await providerFixture(t, completePatches, {
    toolTurns: 8,
    budget: { maxModelCalls: 9, maxToolDispatches: 12, maxKnownTokens: 10_000,
      maxOutputTokens: 900, maxOutputTokensPerInvocation: 100 },
  });
  const { run } = await runRepair(fixture);

  assert.equal(fixture.requests.length, 9);
  assert.equal(run.state, 'awaiting_decision');
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

test('cancelling an active part request aborts the provider and never finalizes its output', async (t) => {
  const started = Promise.withResolvers();
  const release = Promise.withResolvers();
  t.after(() => release.resolve());
  const fixture = await providerFixture(t, async (input) => {
    started.resolve();
    await release.promise;
    return completePatches(input);
  });
  const queued = await command(fixture.app, '/api/repair-runs', fixture.input,
    { branchId: fixture.state.currentBranchId });
  const run = await queued.json();
  const ticking = fixture.worker.tick();
  await started.promise;

  const cancelled = await command(fixture.app, `/api/runs/${run.id}/cancel`, {},
    { branchId: fixture.state.currentBranchId });
  release.resolve();
  await ticking;
  const state = await fixture.store.read();

  assert.equal(cancelled.status, 200);
  assert.equal(state.runs.find((item) => item.id === run.id).state, 'cancelled');
  assert.equal(state.changeSets.some((item) => item.runId === run.id), false);
});
