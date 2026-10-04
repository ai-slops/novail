import { DomainError } from './errors.mjs';

export const branchHeader = 'X-Novail-Branch-Id';

export function resolveBranchScope(state, requestedBranchId) {
  if (requestedBranchId === undefined) {
    if (state.branches.length !== 1) throw new DomainError('BRANCH_REQUIRED', '분기가 여러 개입니다. 요청의 분기 식별자를 지정하세요.', 409);
    return { projectId: state.project.id, branchId: state.currentBranchId, explicit: false };
  }
  if (typeof requestedBranchId !== 'string' || !requestedBranchId.length || requestedBranchId.length > 200) {
    throw new DomainError('SCHEMA_INVALID', '유효한 분기 식별자가 필요합니다.', 422);
  }
  const project = [state, ...state.workspaces].find((item) => item.branches.some((branch) => branch.id === requestedBranchId));
  if (!project) throw new DomainError('BRANCH_MISMATCH', '요청한 분기를 찾을 수 없습니다. 현재 상태를 새로고침하세요.', 409);
  return { projectId: project.project.id, branchId: requestedBranchId, explicit: true };
}

export function assertActiveScope(state, scope) {
  if (state.project.id !== scope.projectId || state.currentBranchId !== scope.branchId) {
    throw new DomainError('BRANCH_MISMATCH', '다른 창에서 작업 분기가 바뀌었습니다. 입력을 보존하고 현재 상태를 새로고침하세요.', 409);
  }
}

export function assertReplayScope(state, record, scope) {
  if (record.projectId === undefined && record.branchId === undefined && !scope.explicit && state.branches.length === 1) return;
  if (record.projectId !== scope.projectId || record.branchId !== scope.branchId) {
    throw new DomainError('IDEMPOTENCY_SCOPE_MISMATCH', '이 요청 키는 다른 작품 또는 분기에 속합니다.', 409);
  }
}

export function assertReadScope(state, branchId) {
  if (branchId !== undefined) assertActiveScope(state, resolveBranchScope(state, branchId));
}
