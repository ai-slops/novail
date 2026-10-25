import { randomUUID } from 'node:crypto';
import { DomainError } from './errors.mjs';
import { appendEvent } from './events.mjs';
import { activeBranch, assertIdleWorkspace, branchFields, branchSummary, captureWorkspace, getBranchSnapshot, validateBranches } from './branch-state.mjs';
import { narrativeContext } from './snapshots.mjs';
import { publicState } from './queries.mjs';
import { ancestorIds } from '../packages/revision/ancestry.mjs';

function assertExpected(state, input) {
  if (state.currentBranchId !== input.expectedBranchId) throw new DomainError('BRANCH_MISMATCH', 'The branch changed. Review the current workspace again.', 409);
  if (state.head !== input.expectedHead) throw new DomainError('STALE_HEAD', 'The base version changed. Review the current workspace again.', 409);
}

export function createBranch(state, input) {
  assertExpected(state, input);
  const name = input.name.trim().normalize('NFC');
  if (state.branches.some((branch) => branch.name.toLocaleLowerCase('ko-KR') === name.toLocaleLowerCase('ko-KR'))) {
    throw new DomainError('BRANCH_NAME_CONFLICT', 'A branch with this name already exists.', 409);
  }
  const source = getBranchSnapshot(state, input.sourceSnapshotId);
  const current = source.id === state.head;
  const context = current ? narrativeContext(state) : source.narrativeContext;
  if (!context) throw new DomainError('SNAPSHOT_CONTEXT_UNAVAILABLE', 'Planning context was not recorded for this older version. Create the branch from the current version.', 409);
  const scenes = current ? structuredClone(state.scenes) : source.sceneManifest.map((metadata) => ({ ...structuredClone(metadata), text: source.sceneTexts[metadata.id] }));
  const origin = activeBranch(state);
  const branch = { id: randomUUID(), name, headSnapshotId: source.id, sourceSnapshotId: source.id,
    sourceBranchId: origin.id, createdAt: new Date().toISOString(),
    snapshotIds: ancestorIds(state, source.id),
    workspace: { scenes, ...structuredClone(context), drafts: {}, candidates: [], changeSets: [], evaluationReports: [], mergePreviews: [], feedback: [], runs: [], jobs: [], runEvents: [] } };
  state.branches.push(branch);
  validateBranches(state);
  appendEvent(state, 'branch.created', { branchId: branch.id, sourceBranchId: origin.id, sourceSnapshotId: source.id, humanRequested: true });
  return branchSummary(state, branch);
}

export function switchBranch(state, targetId, input) {
  assertExpected(state, input);
  assertIdleWorkspace(state);
  const target = state.branches.find((branch) => branch.id === targetId);
  if (!target) throw new DomainError('NOT_FOUND', 'Branch not found for this project.', 404);
  if (target.id === state.currentBranchId) return publicState(state);
  const origin = activeBranch(state);
  origin.workspace = captureWorkspace(state);
  for (const key of branchFields) state[key] = structuredClone(target.workspace[key]);
  delete target.workspace;
  state.currentBranchId = target.id;
  state.head = target.headSnapshotId;
  validateBranches(state);
  appendEvent(state, 'branch.switched', { fromBranchId: origin.id, toBranchId: target.id, humanRequested: true });
  return publicState(state);
}
