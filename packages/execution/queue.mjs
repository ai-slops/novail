import { randomUUID } from 'node:crypto';
import { assertActiveScope, assertReplayScope, resolveBranchScope } from '../../app/branch-scope.mjs';
import { assertRecordBranch, isActiveRecord } from '../../app/branch-state.mjs';
import { prepareRepairInput } from '../../app/repair-input.mjs';
import { executionBudgetSchema } from './contracts.ts';

export class RunError extends Error {
  constructor(code, message, status = 409) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export function appendEvent(state, run, type, details = {}) {
  state.runEvents ??= [];
  const sequence = state.runEvents.filter((event) => event.runId === run.id).length + 1;
  state.runEvents.push({ id: randomUUID(), runId: run.id, sequence, type, details, createdAt: new Date().toISOString() });
}

function proposalRunIsLive(state, proposal) {
  const run = proposal.runId ? state.runs.find((item) => item.id === proposal.runId) : null;
  return !run || (run.state !== 'cancelled' && !run.cancellationRequested);
}

function reopenOrphanedFeedback(state, feedbackIds) {
  for (const feedback of state.feedback.filter((item) => feedbackIds.has(item.id) && item.state === 'awaiting_decision')) {
    const hasCandidate = state.candidates.some((item) => item.feedbackId === feedback.id && item.status === 'pending'
      && proposalRunIsLive(state, item));
    const hasChangeSet = (state.changeSets ?? []).some((item) => item.feedbackIds?.includes(feedback.id)
      && ['proposed', 'pending', 'stale_candidate'].includes(item.status) && proposalRunIsLive(state, item));
    if (!hasCandidate && !hasChangeSet) feedback.state = 'open';
  }
}

function markUsageUnknown(run, job) {
  run.usageKnown = false;
  job.usageState = 'usage_unknown';
}

export async function enqueueRun(store, input) {
  return store.transaction((state) => {
    const scope = resolveBranchScope(state, input.branchId);
    const previous = input.requestKey && state.idempotency[input.requestKey];
    if (previous) {
      if (previous.hash !== input.requestHash) throw new RunError('IDEMPOTENCY_CONFLICT', '같은 키에 다른 요청을 사용할 수 없습니다.');
      assertReplayScope(state, previous, scope);
      return previous.result;
    }
    assertActiveScope(state, scope);
    if (state.head !== input.baseSnapshotId) throw new RunError('STALE_BASE', '작업본이 변경되었습니다.');
    const purpose = input.purpose ?? 'revise_scene';
    let details;
    switch (purpose) {
      case 'revise_scene':
        if (!state.scenes.some((scene) => scene.id === input.sceneId)) throw new RunError('NOT_FOUND', '장면을 찾을 수 없습니다.', 404);
        if (input.feedbackId && !state.feedback.some((feedback) => feedback.id === input.feedbackId && feedback.sceneId === input.sceneId)) throw new RunError('NOT_FOUND', '이 장면의 피드백을 찾을 수 없습니다.', 404);
        details = { sceneId: input.sceneId, feedbackId: input.feedbackId ?? null };
        break;
      case 'repair_bundle': details = prepareRepairInput(state, input); break;
      default: throw new RunError('SCHEMA_INVALID', '지원하지 않는 실행 종류입니다.', 422);
    }
    const run = {
      id: randomUUID(), projectId: state.project.id, branchId: scope.branchId, queueManaged: true,
      state: 'queued', purpose, baseSnapshotId: input.baseSnapshotId,
      ...details, instruction: input.instruction, contextVersion: state.contextVersion ?? 0,
      ...(input.model ? { model: input.model } : {}),
      ...(input.providerApi ? { providerApi: input.providerApi } : {}),
      budget: executionBudgetSchema.parse(input.budget), reservedCalls: 0, reservedOutputTokens: 0,
      actualOutputTokens: 0, actualKnownTokens: 0, usageKnown: true,
      createdAt: new Date().toISOString(), cancellationRequested: false,
    };
    state.runs.push(run);
    state.jobs ??= [];
    state.jobs.push({ id: randomUUID(), runId: run.id, state: 'queued', attempt: 0, leaseUntil: null, leaseToken: null });
    appendEvent(state, run, 'run.queued');
    if (input.requestKey) state.idempotency[input.requestKey] = { hash: input.requestHash, result: structuredClone(run), status: 202,
      projectId: scope.projectId, branchId: scope.branchId, scopeExplicit: scope.explicit };
    return run;
  });
}

export async function controlRun(store, input) {
  return store.transaction((state) => {
    const scope = resolveBranchScope(state, input.branchId);
    const previous = input.requestKey && state.idempotency[input.requestKey];
    if (previous) {
      if (previous.hash !== input.requestHash) throw new RunError('IDEMPOTENCY_CONFLICT', '같은 키에 다른 요청을 사용할 수 없습니다.');
      assertReplayScope(state, previous, scope);
      return previous.result;
    }
    assertActiveScope(state, scope);
    const run = state.runs.find((item) => item.id === input.id && item.queueManaged);
    if (!run) throw new RunError('NOT_FOUND', '작업을 찾을 수 없습니다.', 404);
    assertRecordBranch(state, run);
    const jobs = (state.jobs ?? []).filter((job) => job.runId === run.id);
    switch (input.action) {
      case 'cancel':
        if (['completed', 'failed', 'cancelled'].includes(run.state)) throw new RunError('RUN_FINISHED', '이미 종료된 작업입니다.');
        run.state = 'cancelled';
        run.cancellationRequested = true;
        for (const job of jobs.filter((item) => ['queued', 'running'].includes(item.state))) job.state = 'cancelled';
        const candidates = state.candidates.filter((item) => item.runId === run.id && item.status === 'pending');
        const changeSets = (state.changeSets ?? []).filter((item) => item.runId === run.id && ['proposed', 'pending', 'stale_candidate'].includes(item.status));
        for (const candidate of candidates) candidate.status = 'cancelled';
        for (const changeSet of changeSets) changeSet.status = 'cancelled';
        reopenOrphanedFeedback(state, new Set([
          ...candidates.map((candidate) => candidate.feedbackId).filter(Boolean),
          ...changeSets.flatMap((changeSet) => changeSet.feedbackIds ?? []),
        ]));
        break;
      case 'pause':
        if (run.state !== 'queued') throw new RunError('INVALID_TRANSITION', '대기 중인 작업만 일시 정지할 수 있습니다.');
        run.state = 'paused';
        break;
      case 'resume':
        if (run.state !== 'paused') throw new RunError('INVALID_TRANSITION', '일시 정지된 작업만 재개할 수 있습니다.');
        if (state.head !== run.baseSnapshotId) throw new RunError('STALE_BASE', '재개 전에 새 작업본으로 다시 실행하세요.');
        run.state = jobs.some((job) => job.state === 'running') ? 'running' : 'queued';
        break;
      default:
        throw new RunError('SCHEMA_INVALID', '지원하지 않는 작업 명령입니다.', 422);
    }
    appendEvent(state, run, `run.${run.state}`, { externalCallMayStillBeBilled: jobs.some((job) => job.attempt > 0) });
    if (input.requestKey) state.idempotency[input.requestKey] = { hash: input.requestHash, result: structuredClone(run), status: 200,
      projectId: scope.projectId, branchId: scope.branchId, scopeExplicit: scope.explicit };
    return run;
  });
}

export async function claimJob(store, now = Date.now()) {
  return store.transaction((state) => {
    state.jobs ??= [];
    for (const job of state.jobs) {
      if (job.state !== 'running' || job.leaseUntil > now) continue;
      const run = state.runs.find((item) => item.id === job.runId);
      if (!run || !isActiveRecord(state, run)) continue;
      job.state = 'failed';
      markUsageUnknown(run, job);
      run.state = 'failed';
      run.error = { code: 'USAGE_UNKNOWN', message: '호출 결과를 확인할 수 없습니다. 예약을 유지하며 명시적인 새 실행이 필요합니다.' };
      appendEvent(state, run, 'run.failed', run.error);
    }
    const job = state.jobs.find((item) => item.state === 'queued' && state.runs.some((run) => run.id === item.runId && run.state === 'queued' && isActiveRecord(state, run)));
    if (!job) return null;
    const run = state.runs.find((item) => item.id === job.runId);
    if (!run) return null;
    run.budget = executionBudgetSchema.parse(run.budget);
    if (run.reservedCalls >= run.budget.maxModelCalls || run.actualOutputTokens >= run.budget.maxOutputTokens) {
      job.state = 'failed';
      run.state = 'failed';
      run.error = { code: 'BUDGET_EXCEEDED', message: '실행 예산을 초과했습니다.' };
      appendEvent(state, run, 'run.failed', run.error);
      return null;
    }
    run.reservedCalls++;
    run.state = 'running';
    job.state = 'running';
    job.attempt++;
    job.leaseUntil = now + 120_000;
    job.leaseToken = randomUUID();
    appendEvent(state, run, 'run.started');
    return { job, run };
  });
}

export async function completeJob(store, input, now = Date.now()) {
  return store.transaction((state) => {
    const job = (state.jobs ?? []).find((item) => item.id === input.jobId);
    if (!job || job.leaseToken !== input.leaseToken) return { accepted: false };
    const run = state.runs.find((item) => item.id === job.runId);
    if (!run) return { accepted: false };
    if (job.state === 'cancelled' && run?.cancellationRequested) {
      if (!input.usageManaged && input.usageKnown && job.usageState === undefined) {
        run.actualOutputTokens += input.outputTokens;
        job.usageState = 'reported';
      }
      const managedUsageUnknown = input.usageManaged === true
        && job.modelAttempts?.some((attempt) => ['reserved', 'usage_unknown'].includes(attempt.state));
      if ((!input.usageManaged && !input.usageKnown) || managedUsageUnknown) markUsageUnknown(run, job);
      return { accepted: false };
    }
    if (job.state === 'running' && job.leaseUntil <= now) {
      job.state = 'failed';
      markUsageUnknown(run, job);
      run.state = 'failed';
      run.error = { code: 'USAGE_UNKNOWN', message: '호출 결과를 확인할 수 없습니다. 예약을 유지하며 명시적인 새 실행이 필요합니다.' };
      appendEvent(state, run, 'run.failed', run.error);
      return { accepted: false };
    }
    if (job.state !== 'running') return { accepted: false };
    if (!run || run.state !== 'running' || run.cancellationRequested || !isActiveRecord(state, run)) return { accepted: false };
    if (input.error) {
      if (!input.usageManaged && input.usageKnown) run.actualOutputTokens += input.outputTokens;
      const claimWasAdopted = job.modelAttempts?.some((attempt) => attempt.adoptedClaim) ?? false;
      if (input.releaseReservation && (!input.usageManaged || !claimWasAdopted)) {
        run.reservedCalls = Math.max(0, run.reservedCalls - 1);
      }
      run.state = 'failed';
      run.error = input.error;
      job.state = 'failed';
      job.usageState = input.usageManaged ? 'part-managed' : input.usageKnown ? 'reported' : 'usage_unknown';
      if (job.usageState === 'usage_unknown') run.usageKnown = false;
      appendEvent(state, run, 'run.failed', input.error);
      return { accepted: false };
    }
    if (!input.usageManaged) run.actualOutputTokens += input.outputTokens;
    job.usageState = input.usageManaged ? 'part-managed' : input.usageKnown ? 'reported' : 'estimated';
    if (run.actualOutputTokens > run.budget.maxOutputTokens) {
      run.state = 'failed';
      run.error = { code: 'BUDGET_EXCEEDED', message: '출력 한도를 초과한 후보를 폐기했습니다.' };
      job.state = 'failed';
      appendEvent(state, run, 'run.failed', run.error);
      return { accepted: false };
    }
    const resultRef = input.finalize ? input.finalize(state, run, input.payload).id : input.resultRef;
    job.state = 'succeeded';
    job.resultRef = resultRef;
    run.resultRef = resultRef;
    run.state = 'awaiting_decision';
    run.staleBase = state.head !== run.baseSnapshotId;
    appendEvent(state, run, 'candidate.created', { resultRef });
    appendEvent(state, run, 'decision.required');
    return { accepted: true };
  });
}
