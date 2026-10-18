import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileStore } from '../../app/store.mjs';
import { enqueueRun, controlRun, claimJob, completeJob } from './queue.mjs';
import { heartbeatJob, prepareModelAttempt, settleModelAttempt } from './model-budget.mjs';
import { appendRuntimeEvent } from './runtime-events.mjs';
import { executionBudgetSchema } from './contracts.ts';
import { safeRunSummary } from './public-contract.mjs';

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'novail-queue-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = new FileStore(join(directory, 'state.json'));
  await store.initialize();
  const state = await store.read();
  const run = await enqueueRun(store, {
    sceneId: state.scenes[0].id, instruction: '선택을 명확하게', baseSnapshotId: state.head,
    budget: { maxModelCalls: 1, maxOutputTokens: 5000 },
  });
  return { store, run };
}

test('parallel claims reserve only one call for the same queued job', async (t) => {
  const { store } = await fixture(t);
  const claims = await Promise.all([claimJob(store), claimJob(store)]);
  assert.equal(claims.filter(Boolean).length, 1);
});

test('unknown execution budget fields are rejected after defaults are applied', () => {
  assert.throws(() => executionBudgetSchema.parse({ maxModelCalls: 2, unsupportedLimit: 1 }));
});

test('cancel blocks late result selection', async (t) => {
  const { store, run } = await fixture(t);
  const claim = await claimJob(store);
  await controlRun(store, { id: run.id, action: 'cancel' });
  const completion = { jobId: claim.job.id, leaseToken: claim.job.leaseToken,
    outputTokens: 40, usageKnown: true, resultRef: 'candidate' };
  assert.deepEqual(await completeJob(store, completion), { accepted: false });
  assert.deepEqual(await completeJob(store, completion), { accepted: false });
  const state = await store.read();
  const cancelled = state.runs.find((item) => item.id === run.id);
  const job = state.jobs.find((item) => item.id === claim.job.id);
  assert.equal(cancelled.state, 'cancelled');
  assert.equal(cancelled.actualOutputTokens, 40);
  assert.equal(cancelled.reservedCalls, 1);
  assert.equal(cancelled.resultRef, undefined);
  assert.equal(job.state, 'cancelled');
  assert.equal(job.usageState, 'reported');
  assert.equal(safeRunSummary(cancelled).usage.known, true);
});

test('cancel conservatively retains reservation when late usage is unknown', async (t) => {
  const { store, run } = await fixture(t);
  const claim = await claimJob(store);
  await controlRun(store, { id: run.id, action: 'cancel' });
  assert.deepEqual(await completeJob(store, { jobId: claim.job.id, leaseToken: claim.job.leaseToken,
    outputTokens: 40, usageKnown: false, resultRef: 'candidate' }), { accepted: false });
  const state = await store.read();
  const cancelled = state.runs.find((item) => item.id === run.id);
  const job = state.jobs.find((item) => item.id === claim.job.id);
  assert.equal(cancelled.actualOutputTokens, 0);
  assert.equal(cancelled.reservedCalls, 1);
  assert.equal(job.usageState, 'usage_unknown');
  assert.equal(safeRunSummary(cancelled).usage.known, false);
});

test('expired lease retains uncertain budget and requires explicit new execution', async (t) => {
  const { store, run } = await fixture(t);
  await claimJob(store, 1000);
  await claimJob(store, 121001);
  const state = await store.read();
  const failed = state.runs.find((item) => item.id === run.id);
  assert.equal(failed.error.code, 'USAGE_UNKNOWN');
  assert.equal(failed.reservedCalls, 1);
  assert.equal(safeRunSummary(failed).usage.known, false);
});

test('paused queued job is not leased until resumed', async (t) => {
  const { store, run } = await fixture(t);
  await controlRun(store, { id: run.id, action: 'pause' });
  const claim = await claimJob(store);
  assert.equal(claim, null);
});

test('a running job cannot be paused while external execution continues', async (t) => {
  const { store, run } = await fixture(t);
  await claimJob(store, 1000);

  await assert.rejects(controlRun(store, { id: run.id, action: 'pause' }), { code: 'INVALID_TRANSITION' });
  const state = await store.read();
  assert.equal(state.runs.find((item) => item.id === run.id).state, 'running');
});

test('an expired lease cannot prepare a model attempt and becomes terminal immediately', async (t) => {
  const { store, run } = await fixture(t);
  const claim = await claimJob(store, 1000);

  await assert.rejects(prepareModelAttempt(store, { jobId: claim.job.id, leaseToken: claim.job.leaseToken,
    attemptId: 'expired', requestedOutputTokens: 100 }, 121001), { code: 'LEASE_LOST' });
  const state = await store.read();
  const failed = state.runs.find((item) => item.id === run.id);
  assert.equal(failed.state, 'failed');
  assert.equal(state.jobs.find((item) => item.id === claim.job.id).usageState, 'usage_unknown');
  assert.equal(safeRunSummary(failed).usage.known, false);
});

test('an expired lease cannot be renewed and becomes terminal immediately', async (t) => {
  const { store, run } = await fixture(t);
  const claim = await claimJob(store, 1000);

  assert.deepEqual(await heartbeatJob(store, { jobId: claim.job.id, leaseToken: claim.job.leaseToken }, 121001),
    { accepted: false });
  const state = await store.read();
  const failed = state.runs.find((item) => item.id === run.id);
  assert.equal(failed.state, 'failed');
  assert.equal(state.jobs.find((item) => item.id === claim.job.id).usageState, 'usage_unknown');
  assert.equal(safeRunSummary(failed).usage.known, false);
});

test('late usage settlement is retained but an expired lease cannot finalize', async (t) => {
  const { store, run } = await fixture(t);
  const claim = await claimJob(store, 1000);
  await prepareModelAttempt(store, { jobId: claim.job.id, leaseToken: claim.job.leaseToken,
    attemptId: 'reported-late', requestedOutputTokens: 100 }, 1001);
  await settleModelAttempt(store, { jobId: claim.job.id, leaseToken: claim.job.leaseToken,
    attemptId: 'reported-late', outcome: 'returned', inputTokens: 12, outputTokens: 20 });

  const completed = await completeJob(store, { jobId: claim.job.id, leaseToken: claim.job.leaseToken,
    outputTokens: 0, usageKnown: true, usageManaged: true, resultRef: 'candidate' }, 121001);
  const state = await store.read();
  const failed = state.runs.find((item) => item.id === run.id);
  assert.deepEqual(completed, { accepted: false });
  assert.equal(failed.state, 'failed');
  assert.equal(failed.error.code, 'USAGE_UNKNOWN');
  assert.equal(failed.actualKnownTokens, 32);
  assert.equal(failed.actualOutputTokens, 20);
  assert.equal(failed.resultRef, undefined);
  assert.equal(safeRunSummary(failed).usage.known, false);
});

test('stale lease token cannot select a result', async (t) => {
  const { store } = await fixture(t);
  const claim = await claimJob(store);
  const result = await completeJob(store, { jobId: claim.job.id, leaseToken: 'old-token', outputTokens: 5, resultRef: 'candidate' });
  assert.equal(result.accepted, false);
});

test('the claimed call is adopted once and later model calls reserve atomically', async (t) => {
  const { store } = await fixture(t);
  await store.transaction((state) => { state.runs[0].budget.maxModelCalls = 2; });
  const claim = await claimJob(store);

  const first = await prepareModelAttempt(store, { jobId: claim.job.id, leaseToken: claim.job.leaseToken,
    attemptId: 'attempt-1', requestedOutputTokens: 4000 });
  await settleModelAttempt(store, { jobId: claim.job.id, leaseToken: claim.job.leaseToken,
    attemptId: 'attempt-1', outcome: 'returned', inputTokens: 12, outputTokens: 20 });
  const second = await prepareModelAttempt(store, { jobId: claim.job.id, leaseToken: claim.job.leaseToken,
    attemptId: 'attempt-2', requestedOutputTokens: 4000 });
  const state = await store.read();
  const run = state.runs.find((item) => item.id === claim.run.id);

  assert.equal(first.adoptedClaim, true);
  assert.equal(second.adoptedClaim, false);
  assert.equal(run.reservedCalls, 2);
  assert.equal(run.actualOutputTokens, 20);
  assert.equal(run.actualKnownTokens, 32);
});

test('failed unknown model usage retains reservations while not-attempted releases them', async (t) => {
  const { store } = await fixture(t);
  const claim = await claimJob(store);
  await prepareModelAttempt(store, { jobId: claim.job.id, leaseToken: claim.job.leaseToken,
    attemptId: 'not-attempted', requestedOutputTokens: 4000 });
  await settleModelAttempt(store, { jobId: claim.job.id, leaseToken: claim.job.leaseToken,
    attemptId: 'not-attempted', outcome: 'not-attempted' });
  const retried = await prepareModelAttempt(store, { jobId: claim.job.id, leaseToken: claim.job.leaseToken,
    attemptId: 'unknown', requestedOutputTokens: 4000 });
  await settleModelAttempt(store, { jobId: claim.job.id, leaseToken: claim.job.leaseToken,
    attemptId: 'unknown', outcome: 'unknown' });
  const state = await store.read();
  const run = state.runs.find((item) => item.id === claim.run.id);

  assert.equal(retried.adoptedClaim, false);
  assert.equal(run.reservedCalls, 1);
  assert.equal(run.reservedOutputTokens, 4000);
});

test('progress limits do not suppress later model lifecycle events', async (t) => {
  const { store } = await fixture(t);
  const claim = await claimJob(store);
  await store.transaction((state) => {
    for (let index = 0; index < 128; index++) {
      state.runEvents.push({ id: `progress-${index}`, runId: claim.run.id, sequence: state.runEvents.length + 1,
        type: 'runtime.text.delta', details: { text: 'x' }, createdAt: new Date().toISOString() });
    }
  });

  const lifecycle = await appendRuntimeEvent(store, { jobId: claim.job.id, leaseToken: claim.job.leaseToken,
    type: 'runtime.model.completed', details: { ordinal: 1, tokenUsage: { inputTokens: 1, outputTokens: 1, basis: 'provider-reported' } } });
  const progress = await appendRuntimeEvent(store, { jobId: claim.job.id, leaseToken: claim.job.leaseToken,
    type: 'runtime.text.delta', details: { text: 'blocked' } });
  const state = await store.read();

  assert.equal(lifecycle.accepted, true);
  assert.equal(progress.accepted, false);
  assert.equal(state.runEvents.some((event) => event.type === 'runtime.model.completed'), true);
  assert.equal(state.runEvents.filter((event) => event.type === 'runtime.progress.truncated').length, 1);
});

test('part-managed failures release only claims the model boundary never adopted', async (t) => {
  const first = await fixture(t);
  const unadopted = await claimJob(first.store);
  await completeJob(first.store, { jobId: unadopted.job.id, leaseToken: unadopted.job.leaseToken,
    error: { code: 'PART_START_FAILED', message: 'not started' }, outputTokens: 0, usageKnown: false,
    usageManaged: true, releaseReservation: true });
  const unadoptedState = await first.store.read();

  const second = await fixture(t);
  const adopted = await claimJob(second.store);
  await prepareModelAttempt(second.store, { jobId: adopted.job.id, leaseToken: adopted.job.leaseToken,
    attemptId: 'released-at-boundary', requestedOutputTokens: 4000 });
  await settleModelAttempt(second.store, { jobId: adopted.job.id, leaseToken: adopted.job.leaseToken,
    attemptId: 'released-at-boundary', outcome: 'not-attempted' });
  await completeJob(second.store, { jobId: adopted.job.id, leaseToken: adopted.job.leaseToken,
    error: { code: 'PROVIDER_FAILURE', message: 'not sent' }, outputTokens: 0, usageKnown: false,
    usageManaged: true, releaseReservation: true });
  const adoptedState = await second.store.read();

  assert.equal(unadoptedState.runs[0].reservedCalls, 0);
  assert.equal(adoptedState.runs[0].reservedCalls, 0);
});
