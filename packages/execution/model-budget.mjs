import { isActiveRecord } from '../../app/branch-state.mjs';
import { RunError, appendEvent } from './queue.mjs';

const findTokenLease = (state, input) => {
  const job = (state.jobs ?? []).find((item) => item.id === input.jobId);
  const run = job && state.runs.find((item) => item.id === job.runId);
  if (!job || !run || job.leaseToken !== input.leaseToken) return null;
  return { job, run };
};

const leaseIsActive = (state, lease, now) => lease.job.state === 'running' && lease.run.state === 'running'
  && !lease.run.cancellationRequested && lease.job.leaseUntil > now && isActiveRecord(state, lease.run);

function expireLease(state, lease) {
  lease.job.state = 'failed';
  lease.job.usageState = 'usage_unknown';
  lease.run.usageKnown = false;
  lease.run.state = 'failed';
  lease.run.error = { code: 'USAGE_UNKNOWN',
    message: 'The call result cannot be confirmed. The reservation is retained and an explicit new run is required.' };
  appendEvent(state, lease.run, 'run.failed', lease.run.error);
}

export async function prepareModelAttempt(store, input, now = Date.now()) {
  const result = await store.transaction((state) => {
    const lease = findTokenLease(state, input);
    if (!lease || !leaseIsActive(state, lease, now)) {
      if (lease?.job.state === 'running' && lease.job.leaseUntil <= now) expireLease(state, lease);
      return { ok: false };
    }
    lease.job.modelAttempts ??= [];
    const existing = lease.job.modelAttempts.find((attempt) => attempt.id === input.attemptId);
    if (existing) return { ok: true,
      value: { adoptedClaim: existing.adoptedClaim, reservedOutputTokens: existing.reservedOutputTokens } };
    const heldCalls = lease.job.modelAttempts.filter((attempt) => attempt.holdsCall).length;
    const adoptedClaim = heldCalls === 0 && lease.run.reservedCalls > 0;
    if (!adoptedClaim) {
      if (lease.run.reservedCalls >= lease.run.budget.maxModelCalls) {
        throw new RunError('BUDGET_EXCEEDED', 'The model call budget was exceeded.', 409);
      }
      lease.run.reservedCalls++;
    }
    const outstanding = lease.run.reservedOutputTokens ?? 0;
    const remaining = lease.run.budget.maxOutputTokens - lease.run.actualOutputTokens - outstanding;
    const reservedOutputTokens = Math.min(input.requestedOutputTokens, remaining);
    if (reservedOutputTokens < 1) throw new RunError('BUDGET_EXCEEDED', 'The output token budget was exceeded.', 409);
    lease.run.reservedOutputTokens = outstanding + reservedOutputTokens;
    lease.job.modelAttempts.push({ id: input.attemptId, adoptedClaim, reservedOutputTokens, holdsCall: true,
      state: 'reserved', createdAt: new Date().toISOString() });
    appendEvent(state, lease.run, 'runtime.model.started', {
      ordinal: lease.job.modelAttempts.length,
    });
    return { ok: true, value: { adoptedClaim, reservedOutputTokens } };
  });
  if (!result.ok) throw new RunError('LEASE_LOST', 'The run lease expired or was cancelled.', 409);
  return result.value;
}

export async function settleModelAttempt(store, input) {
  return store.transaction((state) => {
    const lease = findTokenLease(state, input);
    if (!lease) return { accepted: false };
    const attempt = lease.job.modelAttempts?.find((item) => item.id === input.attemptId);
    if (!attempt || attempt.state !== 'reserved') return { accepted: false };
    if (input.outcome === 'not-attempted') {
      lease.run.reservedCalls = Math.max(0, lease.run.reservedCalls - 1);
      lease.run.reservedOutputTokens = Math.max(0, (lease.run.reservedOutputTokens ?? 0) - attempt.reservedOutputTokens);
      attempt.holdsCall = false;
      attempt.state = 'released';
      return { accepted: true };
    }
    if (input.outcome === 'unknown') {
      attempt.state = 'usage_unknown';
      lease.run.usageKnown = false;
      return { accepted: true };
    }
    const outputTokens = input.outputTokens ?? attempt.reservedOutputTokens;
    const inputTokens = input.inputTokens ?? 0;
    lease.run.actualOutputTokens += outputTokens;
    lease.run.actualKnownTokens = (lease.run.actualKnownTokens ?? 0) + inputTokens + outputTokens;
    lease.run.reservedOutputTokens = Math.max(0, (lease.run.reservedOutputTokens ?? 0) - attempt.reservedOutputTokens);
    attempt.state = input.outputTokens === undefined ? 'estimated' : 'reported';
    attempt.inputTokens = input.inputTokens;
    attempt.outputTokens = outputTokens;
    appendEvent(state, lease.run, 'runtime.model.completed', {
      ordinal: lease.job.modelAttempts.indexOf(attempt) + 1,
      tokenUsage: { inputTokens: input.inputTokens ?? null, outputTokens,
        basis: input.outputTokens === undefined ? 'estimated' : 'provider-reported' },
    });
    if (lease.run.actualKnownTokens > lease.run.budget.maxKnownTokens
      || lease.run.actualOutputTokens > lease.run.budget.maxOutputTokens) {
      lease.run.state = 'failed';
      lease.run.error = { code: 'BUDGET_EXCEEDED', message: 'The run token budget was exceeded.' };
      lease.job.state = 'failed';
      lease.job.usageState = input.outputTokens === undefined ? 'estimated' : 'reported';
      appendEvent(state, lease.run, 'run.failed', lease.run.error);
    }
    return { accepted: true };
  });
}

export async function heartbeatJob(store, input, now = Date.now()) {
  return store.transaction((state) => {
    const lease = findTokenLease(state, input);
    if (!lease || !leaseIsActive(state, lease, now)) {
      if (lease?.job.state === 'running' && lease.job.leaseUntil <= now) expireLease(state, lease);
      return { accepted: false };
    }
    lease.job.leaseUntil = now + 120_000;
    return { accepted: true };
  });
}
