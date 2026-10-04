import { randomUUID } from 'node:crypto';
import { DomainError } from './errors.mjs';
import { appendEvent } from './events.mjs';
import { activeBranch, assertIdleWorkspace, branchFields, branchSummary, captureWorkspace, getBranchSnapshot, validateBranches } from './branch-state.mjs';
import { narrativeContext } from './snapshots.mjs';
import { publicState } from './queries.mjs';
import { ancestorIds } from '../packages/revision/ancestry.mjs';

function assertExpected(state, input) {
  if (state.currentBranchId !== input.expectedBranchId) throw new DomainError('BRANCH_MISMATCH', '분기가 변경되었습니다. 현재 작업본을 다시 확인하세요.', 409);
  if (state.head !== input.expectedHead) throw new DomainError('STALE_HEAD', '기준본이 변경되었습니다. 현재 작업본을 다시 확인하세요.', 409);
}

export function createBranch(state, input) {
  assertExpected(state, input);
  const name = input.name.trim().normalize('NFC');
  if (state.branches.some((branch) => branch.name.toLocaleLowerCase('ko-KR') === name.toLocaleLowerCase('ko-KR'))) {
    throw new DomainError('BRANCH_NAME_CONFLICT', '같은 이름의 분기가 이미 있습니다.', 409);
  }
  const source = getBranchSnapshot(state, input.sourceSnapshotId);
  const current = source.id === state.head;
  const context = current ? narrativeContext(state) : source.narrativeContext;
  if (!context) throw new DomainError('SNAPSHOT_CONTEXT_UNAVAILABLE', '이전 버전에는 기획 맥락이 기록되지 않았습니다. 현재 기준본에서 분기를 만드세요.', 409);
  const scenes = current ? structuredClone(state.scenes) : source.sceneManifest.map((metadata) => ({ ...structuredClone(metadata), text: source.sceneTexts[metadata.id] }));
  const origin = activeBranch(state);
  const branch = { id: randomUUID(), name, headSnapshotId: source.id, sourceSnapshotId: source.id,
    sourceBranchId: origin.id, createdAt: new Date().toISOString(),
    snapshotIds: ancestorIds(state, source.id),
    workspace: { scenes, ...structuredClone(context), drafts: {}, candidates: [], changeSets: [], mergePreviews: [], feedback: [], runs: [], jobs: [], runEvents: [] } };
  state.branches.push(branch);
  validateBranches(state);
  appendEvent(state, 'branch.created', { branchId: branch.id, sourceBranchId: origin.id, sourceSnapshotId: source.id, humanRequested: true });
  return branchSummary(state, branch);
}

export function switchBranch(state, targetId, input) {
  assertExpected(state, input);
  assertIdleWorkspace(state);
  const target = state.branches.find((branch) => branch.id === targetId);
  if (!target) throw new DomainError('NOT_FOUND', '이 작품의 분기를 찾을 수 없습니다.', 404);
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
