import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono } from 'hono';
import { GenerationError } from '../../app/errors.mjs';
import { FileStore } from '../../app/store.mjs';
import { createWorker } from './worker.mjs';
import { mountRunRoutes } from './routes.mjs';
import { enqueueRun, controlRun } from './queue.mjs';

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'novail-worker-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = new FileStore(join(directory, 'state.json'));
  await store.initialize();
  const state = await store.read();
  return { store, input: { sceneId: state.scenes[0].id, instruction: '선택을 명확하게', baseSnapshotId: state.head, budget: { maxModelCalls: 1, maxOutputTokens: 5000 } } };
}

test('cancel during external execution prevents candidate persistence', async (t) => {
  const { store, input } = await fixture(t);
  const run = await enqueueRun(store, input);
  const started = Promise.withResolvers();
  const output = Promise.withResolvers();
  let finalized = false;
  const worker = createWorker({ store,
    execute: async () => { started.resolve(); return output.promise; },
    finalize: () => { finalized = true; return { id: 'candidate' }; },
  });
  const running = worker.tick();
  await started.promise;
  await controlRun(store, { id: run.id, action: 'cancel' });
  worker.cancel(run.id);
  output.resolve({ text: '늦게 도착한 결과' });
  await running;
  assert.equal(finalized, false);
});

test('successful worker generates a candidate but never changes canonical head', async (t) => {
  const { store, input } = await fixture(t);
  const run = await enqueueRun(store, input);
  const worker = createWorker({ store, execute: async () => ({ text: '수정 후보', outputTokens: 4 }),
    finalize: (state) => { const candidate = { id: 'new-candidate', status: 'pending' }; state.candidates.push(candidate); return candidate; },
  });
  await worker.tick();
  const state = await store.read();
  assert.equal(state.head, input.baseSnapshotId);
  assert.equal(state.runs.find((item) => item.id === run.id).state, 'awaiting_decision');
});

test('run endpoints replay events after Last-Event-ID', async (t) => {
  const { store, input } = await fixture(t);
  const worker = createWorker({ store, execute: async () => ({ text: '수정 후보' }), finalize: () => ({ id: 'candidate' }) });
  const app = new Hono();
  mountRunRoutes(app, { store, worker });
  const created = await app.request('/api/runs', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() }, body: JSON.stringify(input) });
  const run = await created.json();
  await worker.tick();
  const state = await store.read();
  const first = state.runEvents.find((event) => event.runId === run.id);
  const response = await app.request(`/api/runs/${run.id}/events`, { headers: { 'Last-Event-ID': first.id } });
  const events = await response.text();
  assert.equal(created.status, 202);
  assert.ok(events.includes('event: decision.required'));
  assert.ok(!events.includes(`id: ${first.id}`));
});

test('same idempotency key returns same run without duplicate work', async (t) => {
  const { store, input } = await fixture(t);
  const first = await enqueueRun(store, { ...input, requestKey: 'same', requestHash: 'payload' });
  const second = await enqueueRun(store, { ...input, requestKey: 'same', requestHash: 'payload' });
  assert.equal(first.id, second.id);
});

test('changed payload cannot reuse run idempotency key', async (t) => {
  const { store, input } = await fixture(t);
  await enqueueRun(store, { ...input, requestKey: 'same', requestHash: 'first' });
  await assert.rejects(enqueueRun(store, { ...input, requestKey: 'same', requestHash: 'second' }), { code: 'IDEMPOTENCY_CONFLICT' });
});

test('worker rejects non-allowlisted generation diagnostics before persistence and logging', async (t) => {
  const { store, input } = await fixture(t);
  const run = await enqueueRun(store, input);
  const calls = [];
  const originalError = console.error;
  console.error = (...args) => { calls.push(args); };
  t.after(() => { console.error = originalError; });
  const worker = createWorker({ store, execute: async () => {
    throw new GenerationError('PROVIDER_FAILURE', '생성 실패', { invocationStarted: true, usageManaged: true,
      diagnostics: { stage: 'provider_http', retryable: false, reasonCode: 'provider_http_error', privatePayload: 'secret' } });
  }, finalize: () => ({ id: 'discard' }) });

  await worker.tick();
  const failed = (await store.read()).runs.find((item) => item.id === run.id);

  assert.equal(failed.error.diagnostics, undefined);
  assert.equal(JSON.stringify(calls).includes('secret'), false);
});
