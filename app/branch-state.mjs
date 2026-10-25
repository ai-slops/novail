import { DomainError } from './errors.mjs';

export const branchFields = Object.freeze([
  'scenes', 'plans', 'dependencies', 'contextVersion', 'drafts', 'feedback', 'candidates', 'changeSets', 'evaluationReports', 'mergePreviews', 'runs', 'jobs', 'runEvents',
]);
export const projectFields = Object.freeze([
  ...branchFields, 'project', 'head', 'snapshots', 'editions', 'branches', 'currentBranchId',
]);
export const mainBranchId = (projectId) => `main-${projectId}`;
export const captureWorkspace = (state) => structuredClone(Object.fromEntries(branchFields.map((key) => [key, state[key]])));
export const captureProject = (state) => structuredClone(Object.fromEntries(projectFields.map((key) => [key, state[key]])));

export function activeBranch(state) {
  const branch = state.branches.find((item) => item.id === state.currentBranchId);
  if (!branch) throw new DomainError('BRANCH_STATE_INVALID', 'Active branch information is missing.', 409);
  return branch;
}

export function validateBranches(state) {
  const catalog = new Set(state.snapshots.map((snapshot) => snapshot.id));
  for (const branch of state.branches) {
    const ids = new Set(branch.snapshotIds);
    if (ids.size !== branch.snapshotIds.length || !ids.has(branch.headSnapshotId) || !ids.has(branch.sourceSnapshotId)
      || [...ids].some((id) => !catalog.has(id))) {
      throw new DomainError('BRANCH_STATE_INVALID', 'Branch snapshot references are inconsistent.', 409);
    }
    const current = branch.id === state.currentBranchId;
    if (current ? Boolean(branch.workspace) || state.head !== branch.headSnapshotId : !branch.workspace) {
      throw new DomainError('BRANCH_STATE_INVALID', 'The selected branch workspace state is inconsistent.', 409);
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
  state.evaluationReports ??= [];
  state.mergePreviews ??= [];
  if (!state.branches) {
    const first = state.snapshots[0];
    if (!first) throw new DomainError('BRANCH_STATE_INVALID', 'The project has no initial snapshot.', 409);
    state.currentBranchId = mainBranchId(state.project.id);
    state.branches = [{ id: state.currentBranchId, name: 'Main workspace', headSnapshotId: state.head,
      sourceSnapshotId: first.id, sourceBranchId: null, createdAt: first.createdAt,
      snapshotIds: state.snapshots.map((snapshot) => snapshot.id) }];
  }
  for (const branch of state.branches) {
    if (branch.workspace) {
      branch.workspace.changeSets ??= [];
      branch.workspace.evaluationReports ??= [];
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
  state.revisionSchemaVersion = 2;
  return state;
}

export function visibleSnapshots(state) {
  const membership = new Set(activeBranch(state).snapshotIds);
  return state.snapshots.filter((snapshot) => membership.has(snapshot.id));
}

export function getBranchSnapshot(state, id) {
  if (!activeBranch(state).snapshotIds.includes(id)) throw new DomainError('NOT_FOUND', 'Snapshot not found in this branch.', 404);
  const snapshot = state.snapshots.find((item) => item.id === id);
  if (!snapshot) throw new DomainError('NOT_FOUND', 'Snapshot not found.', 404);
  return snapshot;
}

export const branchSummary = (state, branch) => ({
  id: branch.id, name: branch.name, headSnapshotId: branch.headSnapshotId,
  sourceSnapshotId: branch.sourceSnapshotId, sourceBranchId: branch.sourceBranchId,
  createdAt: branch.createdAt, isCurrent: branch.id === state.currentBranchId, snapshotCount: branch.snapshotIds.length,
});

export function assertIdleWorkspace(state) {
  if (state.runs.some((run) => ['queued', 'running', 'paused'].includes(run.state))) {
    throw new DomainError('RUN_ACTIVE', 'Complete or cancel active work before switching branches or projects.', 409);
  }
}

export const isActiveRecord = (state, record) => (record.projectId === undefined || record.projectId === state.project.id)
  && (record.branchId ?? mainBranchId(record.projectId ?? state.project.id)) === state.currentBranchId;

export function assertRecordBranch(state, record) {
  if (!isActiveRecord(state, record)) {
    throw new DomainError('BRANCH_MISMATCH', 'This result was created in another branch. Review it in its original branch.', 409);
  }
}
