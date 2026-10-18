import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { FileStore } from '../../app/store.mjs';
import { controlRun, claimJob, completeJob, enqueueRun } from './queue.mjs';
import { prepareModelAttempt, settleModelAttempt } from './model-budget.mjs';
import { safeRunSummary } from './public-contract.mjs';

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'novail-usage-known-'));
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

test('cancel reports unknown usage when a part-managed model attempt remains unsettled', async (t) => {
  const { store, run } = await fixture(t);
  const claim = await claimJob(store);
  await prepareModelAttempt(store, { jobId: claim.job.id, leaseToken: claim.job.leaseToken,
    attemptId: 'unsettled', requestedOutputTokens: 100 });
  await controlRun(store, { id: run.id, action: 'cancel' });

  await completeJob(store, { jobId: claim.job.id, leaseToken: claim.job.leaseToken,
    outputTokens: 0, usageKnown: false, usageManaged: true, resultRef: 'candidate' });
  const state = await store.read();

  assert.equal(state.jobs.find((item) => item.id === claim.job.id).usageState, 'usage_unknown');
  assert.equal(safeRunSummary(state.runs.find((item) => item.id === run.id)).usage.known, false);
});

test('cancel preserves known usage when every part-managed model attempt settled', async (t) => {
  const { store, run } = await fixture(t);
  const claim = await claimJob(store);
  await prepareModelAttempt(store, { jobId: claim.job.id, leaseToken: claim.job.leaseToken,
    attemptId: 'settled', requestedOutputTokens: 100 });
  await settleModelAttempt(store, { jobId: claim.job.id, leaseToken: claim.job.leaseToken,
    attemptId: 'settled', outcome: 'returned', inputTokens: 12, outputTokens: 20 });
  await controlRun(store, { id: run.id, action: 'cancel' });

  await completeJob(store, { jobId: claim.job.id, leaseToken: claim.job.leaseToken,
    outputTokens: 0, usageKnown: false, usageManaged: true, resultRef: 'candidate' });
  const state = await store.read();

  assert.equal(safeRunSummary(state.runs.find((item) => item.id === run.id)).usage.known, true);
});

test('an unknown non-managed failure is unknown in the public run summary', async (t) => {
  const { store } = await fixture(t);
  const claim = await claimJob(store);

  await completeJob(store, { jobId: claim.job.id, leaseToken: claim.job.leaseToken,
    error: { code: 'PROVIDER_FAILURE', message: 'failed' }, outputTokens: 0, usageKnown: false });
  const state = await store.read();

  assert.equal(state.jobs.find((item) => item.id === claim.job.id).usageState, 'usage_unknown');
  assert.equal(safeRunSummary(state.runs[0]).usage.known, false);
});
