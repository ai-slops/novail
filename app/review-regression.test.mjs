import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createSeed } from './seed.mjs';
import { addCandidate, addPlan, commitCandidate, updateProject } from './domain.mjs';
import { FileStore } from './store.mjs';
import { createApplicationWorker } from './execution.mjs';
import { createApp } from './api.mjs';
import { enqueueRun, claimJob, completeJob, controlRun } from '../packages/execution/queue.mjs';

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'novail-review-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const store = new FileStore(join(dir, 'state.json'));
  await store.initialize();
  const state = await store.read();
  const input = { sceneId: 'scene-7', baseSnapshotId: state.head, instruction: '선택을 보강', budget: { maxModelCalls: 1, maxOutputTokens: 5000 } };
  return { store, input };
}

test('changed planning context invalidates a previously generated candidate', () => {
  const state = createSeed();
  const scene = state.scenes.find((item) => item.id === 'scene-7');
  const candidate = addCandidate(state, { input: { sceneId: scene.id, baseSnapshotId: state.head, instruction: '개정' }, proposedText: scene.text, adapterLabel: 'human' });
  addPlan(state, { title: '새 제약', kind: 'constraint', description: '공개 시점 변경' });
  assert.throws(() => commitCandidate(state, candidate.id, { expectedHead: state.head, hash: candidate.hash }), { code: 'STALE_CONTEXT' });
});

test('active work prevents project switching from losing its result', async (t) => {
  const { store, input } = await fixture(t);
  await enqueueRun(store, input);
  await assert.rejects(store.transaction((state) => updateProject(state, { title: '다른 작품', direction: '새 방향' })), { code: 'RUN_ACTIVE' });
});

test('over-budget completion records consumed usage even when candidate is discarded', async (t) => {
  const { store, input } = await fixture(t);
  const run = await enqueueRun(store, { ...input, budget: { maxModelCalls: 1, maxOutputTokens: 5 } });
  const { job } = await claimJob(store);
  await completeJob(store, { jobId: job.id, leaseToken: job.leaseToken, outputTokens: 6, usageKnown: true, resultRef: 'discard' });
  const state = await store.read();
  assert.equal(state.runs.find((item) => item.id === run.id).actualOutputTokens, 6);
  assert.equal(state.jobs.find((item) => item.id === job.id).usageState, 'reported');
});

test('cancelling pending adoption preserves succeeded job execution history', async (t) => {
  const { store, input } = await fixture(t);
  const run = await enqueueRun(store, input);
  const { job } = await claimJob(store);
  await completeJob(store, { jobId: job.id, leaseToken: job.leaseToken, outputTokens: 4, usageKnown: true, resultRef: 'candidate' });
  await controlRun(store, { id: run.id, action: 'cancel' });
  assert.equal((await store.read()).jobs.find((item) => item.id === job.id).state, 'succeeded');
});

test('configured provider feedback goes through actual HTTP gateway and adopts linked feedback', async (t) => {
  const { store, input } = await fixture(t);
  const base = await store.read();
  const text = base.scenes.find((scene) => scene.id === input.sceneId).text;
  let requestedLimit = 0;
  let requestedModel = '';
  const provider = createServer(async (request, response) => {
    let body = '';
    for await (const chunk of request) body += chunk;
    const parsedBody = JSON.parse(body);
    requestedLimit = parsedBody.max_completion_tokens;
    requestedModel = parsedBody.model;
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ text: `${text}\n새 결의.` }) } }], usage: { completion_tokens: 50 } }));
  });
  provider.listen(0, '127.0.0.1');
  await once(provider, 'listening');
  t.after(() => provider.close());
  const address = provider.address();
  assert.ok(address && typeof address === 'object');
  const oldKey = process.env.OPENAI_API_KEY;
  const oldUrl = process.env.OPENAI_BASE_URL;
  process.env.OPENAI_API_KEY = 'test-only-key';
  process.env.OPENAI_BASE_URL = `http://127.0.0.1:${address.port}`;
  t.after(() => {
    if (oldKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = oldKey;
    if (oldUrl === undefined) delete process.env.OPENAI_BASE_URL; else process.env.OPENAI_BASE_URL = oldUrl;
  });
  const worker = createApplicationWorker(store);
  const app = createApp({ store, worker });
  const post = (path, body) => app.request(path, { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() }, body: JSON.stringify(body) });
  const feedback = await (await post('/api/feedback', { sceneId: input.sceneId, text: input.instruction, scope: 'scene' })).json();
  const runResponse = await post('/api/runs', { ...input, model: 'selected-feedback-model', feedbackId: feedback.id });
  assert.equal(runResponse.status, 202);
  await worker.tick();
  const state = await store.read();
  const candidate = state.candidates.at(-1);
  assert.ok(candidate);
  assert.equal(candidate.feedbackId, feedback.id);
  assert.equal(requestedLimit, 4096);
  assert.equal(requestedModel, 'selected-feedback-model');
  const committed = await post(`/api/candidates/${candidate.id}/commit`, { expectedHead: state.head, hash: candidate.hash });
  assert.equal(committed.status, 200);
  assert.equal((await store.read()).feedback.find((item) => item.id === feedback.id).state, 'applied');
});
