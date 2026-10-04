import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileStore } from '../../app/store.mjs';
import { enqueueRun, controlRun, claimJob, completeJob } from './queue.mjs';

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
  assert.equal(job.usageState, undefined);
});

test('expired lease retains uncertain budget and requires explicit new execution', async (t) => {
  const { store, run } = await fixture(t);
  await claimJob(store, 1000);
  await claimJob(store, 121001);
  const state = await store.read();
  const failed = state.runs.find((item) => item.id === run.id);
  assert.equal(failed.error.code, 'USAGE_UNKNOWN');
  assert.equal(failed.reservedCalls, 1);
});

test('paused queued job is not leased until resumed', async (t) => {
  const { store, run } = await fixture(t);
  await controlRun(store, { id: run.id, action: 'pause' });
  const claim = await claimJob(store);
  assert.equal(claim, null);
});

test('stale lease token cannot select a result', async (t) => {
  const { store } = await fixture(t);
  const claim = await claimJob(store);
  const result = await completeJob(store, { jobId: claim.job.id, leaseToken: 'old-token', outputTokens: 5, resultRef: 'candidate' });
  assert.equal(result.accepted, false);
});
