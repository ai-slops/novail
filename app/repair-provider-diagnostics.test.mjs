import assert from 'node:assert/strict';
import test from 'node:test';
import { command } from './branch-test-support.mjs';
import { completePatches, providerFixture, runRepair, TOOL_IDS } from './repair-provider-test-support.mjs';

test('Responses protocol completes the Part tool loop with strict structured output', async (t) => {
  const fixture = await providerFixture(t, completePatches, { api: 'responses' });
  const { run } = await runRepair(fixture);

  assert.equal(run.state, 'awaiting_decision');
  assert.equal(fixture.requests.length, 2);
  assert.equal(fixture.requests[0].max_output_tokens, 2048);
  assert.equal(fixture.requests[0].text.format.type, 'json_schema');
  assert.equal(fixture.requests[0].text.format.strict, true);
  assert.deepEqual(fixture.requests[0].tools.map((tool) => tool.name), TOOL_IDS);
});

test('Responses protocol accepts the informational Codex metadata event', async (t) => {
  const fixture = await providerFixture(t, completePatches, { api: 'responses', responseMetadata: true });

  const { run } = await runRepair(fixture);

  assert.equal(run.state, 'awaiting_decision');
  assert.equal(fixture.requests.length, 2);
});

test('provider HTTP failures persist and expose only allowlisted diagnostics', async (t) => {
  const privateMessage = 'private upstream payload must never escape';
  const fixture = await providerFixture(t, completePatches, { httpFailure: {
    status: 400, code: 'unsupported_capability', type: 'router4u_error', requestId: 'safe-request-id', privateMessage,
  } });
  const calls = [];
  const originalError = console.error;
  console.error = (...args) => { calls.push(args); };
  t.after(() => { console.error = originalError; });

  const { run } = await runRepair(fixture);
  const response = await fixture.app.request(`/api/runs/${run.id}`, {
    headers: { 'X-Novail-Branch-Id': fixture.state.currentBranchId },
  });
  const detail = await response.json();
  const events = await (await fixture.app.request(`/api/runs/${run.id}/events`, {
    headers: { 'X-Novail-Branch-Id': fixture.state.currentBranchId },
  })).text();
  const log = calls.find(([event]) => event === 'worker.generation_failed');

  assert.deepEqual(detail.error.diagnostics, {
    stage: 'provider_http', providerStatus: 400, providerCode: 'unsupported_capability',
    requestId: 'safe-request-id', retryable: false, reasonCode: 'unsupported_capability',
  });
  assert.equal(detail.usage.known, false);
  assert.equal(events.includes('unsupported_capability'), true);
  assert.ok(log);
  assert.deepEqual(JSON.parse(log[1]), { runId: run.id, stage: 'provider_http', providerStatus: 400,
    providerCode: 'unsupported_capability', requestId: 'safe-request-id', retryable: false,
    reasonCode: 'unsupported_capability' });
  assert.equal(JSON.stringify({ detail, events, calls }).includes(privateMessage), false);
});

test('the queued provider protocol remains immutable when the environment changes before execution', async (t) => {
  const fixture = await providerFixture(t, completePatches, { api: 'responses' });
  const queued = await command(fixture.app, '/api/repair-runs', fixture.input, { branchId: fixture.state.currentBranchId });
  const queuedRun = await queued.json();
  process.env.OPENAI_API = 'chat-completions';

  await fixture.worker.tick();
  const run = (await fixture.store.read()).runs.find((item) => item.id === queuedRun.id);

  assert.equal(fixture.requests[0].input[0].role, 'system');
  assert.equal(run.providerApi, 'responses');
});
