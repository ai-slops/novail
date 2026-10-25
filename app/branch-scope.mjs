import { DomainError } from './errors.mjs';

export const branchHeader = 'X-Novail-Branch-Id';

export function resolveBranchScope(state, requestedBranchId) {
  if (requestedBranchId === undefined) {
    if (state.branches.length !== 1) throw new DomainError('BRANCH_REQUIRED', 'Multiple branches exist. Specify the branch ID for the request.', 409);
    return { projectId: state.project.id, branchId: state.currentBranchId, explicit: false };
  }
  if (typeof requestedBranchId !== 'string' || !requestedBranchId.length || requestedBranchId.length > 200) {
    throw new DomainError('SCHEMA_INVALID', 'A valid branch ID is required.', 422);
  }
  const project = [state, ...state.workspaces].find((item) => item.branches.some((branch) => branch.id === requestedBranchId));
  if (!project) throw new DomainError('BRANCH_MISMATCH', 'The requested branch was not found. Refresh the current state.', 409);
  return { projectId: project.project.id, branchId: requestedBranchId, explicit: true };
}

export function assertActiveScope(state, scope) {
  if (state.project.id !== scope.projectId || state.currentBranchId !== scope.branchId) {
    throw new DomainError('BRANCH_MISMATCH', 'The working branch changed in another window. Preserve your input and refresh the current state.', 409);
  }
}

export function assertReplayScope(state, record, scope) {
  if (record.projectId === undefined && record.branchId === undefined && !scope.explicit && state.branches.length === 1) return;
  if (record.projectId !== scope.projectId || record.branchId !== scope.branchId) {
    throw new DomainError('IDEMPOTENCY_SCOPE_MISMATCH', 'This request key belongs to a different project or branch.', 409);
  }
}

export function assertReadScope(state, branchId) {
  if (branchId !== undefined) assertActiveScope(state, resolveBranchScope(state, branchId));
}
