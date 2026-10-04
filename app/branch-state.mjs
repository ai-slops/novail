import { DomainError } from './errors.mjs';

export const branchFields = Object.freeze([
  'scenes', 'plans', 'dependencies', 'contextVersion', 'drafts', 'feedback', 'candidates', 'changeSets', 'mergePreviews', 'runs', 'jobs', 'runEvents',
]);
export const projectFields = Object.freeze([
  ...branchFields, 'project', 'head', 'snapshots', 'editions', 'branches', 'currentBranchId',
]);
export const mainBranchId = (projectId) => `main-${projectId}`;
export const captureWorkspace = (state) => structuredClone(Object.fromEntries(branchFields.map((key) => [key, state[key]])));
export const captureProject = (state) => structuredClone(Object.fromEntries(projectFields.map((key) => [key, state[key]])));

export function activeBranch(state) {
  const branch = state.branches.find((item) => item.id === state.currentBranchId);
  if (!branch) throw new DomainError('BRANCH_STATE_INVALID', '활성 분기 정보를 찾을 수 없습니다.', 409);
  return branch;
}

export function validateBranches(state) {
  const catalog = new Set(state.snapshots.map((snapshot) => snapshot.id));
  for (const branch of state.branches) {
    const ids = new Set(branch.snapshotIds);
    if (ids.size !== branch.snapshotIds.length || !ids.has(branch.headSnapshotId) || !ids.has(branch.sourceSnapshotId)
      || [...ids].some((id) => !catalog.has(id))) {
      throw new DomainError('BRANCH_STATE_INVALID', '분기 스냅샷 참조가 일치하지 않습니다.', 409);
    }
    const current = branch.id === state.currentBranchId;
    if (current ? Boolean(branch.workspace) || state.head !== branch.headSnapshotId : !branch.workspace) {
      throw new DomainError('BRANCH_STATE_INVALID', '분기 작업 공간의 선택 상태가 일치하지 않습니다.', 409);
    }
  }
  activeBranch(state);
}

export function initializeProjectBranches(state) {
  state.contextVersion ??= 0;
  state.jobs ??= [];
  state.runEvents ??= [];
  state.editions ??= [];
  state.changeSets ??= [];
  state.mergePreviews ??= [];
  if (!state.branches) {
    const first = state.snapshots[0];
    if (!first) throw new DomainError('BRANCH_STATE_INVALID', '기본 스냅샷이 없는 작품입니다.', 409);
    state.currentBranchId = mainBranchId(state.project.id);
    state.branches = [{ id: state.currentBranchId, name: '주 작업본', headSnapshotId: state.head,
      sourceSnapshotId: first.id, sourceBranchId: null, createdAt: first.createdAt,
      snapshotIds: state.snapshots.map((snapshot) => snapshot.id) }];
  }
  for (const branch of state.branches) {
    if (branch.workspace) {
      branch.workspace.changeSets ??= [];
      branch.workspace.mergePreviews ??= [];
    }
  }
  validateBranches(state);
  return state;
}

export function initializeBranches(state) {
  const projects = [state, ...state.workspaces];
  if (state.branchSchemaVersion !== 1 || projects.some((project) => !project.branches)) {
    const jobs = [...new Map([...projects.flatMap((project) => project.jobs ?? []), ...(state.legacyExecution?.jobs ?? [])].map((job) => [job.id, job])).values()];
    const events = [...new Map([...projects.flatMap((project) => project.runEvents ?? []), ...(state.legacyExecution?.runEvents ?? [])].map((event) => [event.id, event])).values()];
    const ownedRuns = new Set(projects.flatMap((project) => project.runs.map((run) => run.id)));
    for (const project of projects) {
      const runs = new Set(project.runs.map((run) => run.id));
      project.jobs = structuredClone(jobs.filter((job) => runs.has(job.runId)));
      project.runEvents = structuredClone(events.filter((event) => runs.has(event.runId)));
    }
    // Legacy execution records without an owning run remain available for audit, never discarded.
    state.legacyExecution = { jobs: jobs.filter((job) => !ownedRuns.has(job.runId)),
      runEvents: events.filter((event) => !ownedRuns.has(event.runId)) };
    state.branchSchemaVersion = 1;
  }
  for (const project of projects) initializeProjectBranches(project);
  state.revisionSchemaVersion = 1;
  return state;
}

export function visibleSnapshots(state) {
  const membership = new Set(activeBranch(state).snapshotIds);
  return state.snapshots.filter((snapshot) => membership.has(snapshot.id));
}

export function getBranchSnapshot(state, id) {
  if (!activeBranch(state).snapshotIds.includes(id)) throw new DomainError('NOT_FOUND', '이 분기의 스냅샷을 찾을 수 없습니다.', 404);
  const snapshot = state.snapshots.find((item) => item.id === id);
  if (!snapshot) throw new DomainError('NOT_FOUND', '스냅샷을 찾을 수 없습니다.', 404);
  return snapshot;
}

export const branchSummary = (state, branch) => ({
  id: branch.id, name: branch.name, headSnapshotId: branch.headSnapshotId,
  sourceSnapshotId: branch.sourceSnapshotId, sourceBranchId: branch.sourceBranchId,
  createdAt: branch.createdAt, isCurrent: branch.id === state.currentBranchId, snapshotCount: branch.snapshotIds.length,
});

export function assertIdleWorkspace(state) {
  if (state.runs.some((run) => ['queued', 'running', 'paused'].includes(run.state))) {
    throw new DomainError('RUN_ACTIVE', '진행 중인 작업을 완료하거나 취소한 뒤 분기 또는 작품을 전환하세요.', 409);
  }
}

export const isActiveRecord = (state, record) => (record.projectId === undefined || record.projectId === state.project.id)
  && (record.branchId ?? mainBranchId(record.projectId ?? state.project.id)) === state.currentBranchId;

export function assertRecordBranch(state, record) {
  if (!isActiveRecord(state, record)) {
    throw new DomainError('BRANCH_MISMATCH', '다른 분기에서 만든 결과입니다. 원래 분기에서 검토하세요.', 409);
  }
}
