import { randomUUID } from 'node:crypto';
import { DomainError } from './errors.mjs';
import { appendEvent } from './events.mjs';
import { assertIdleWorkspace, captureProject, initializeProjectBranches, projectFields, validateBranches } from './branch-state.mjs';
import { makeSnapshot } from './snapshots.mjs';
import { publicState } from './queries.mjs';

export function updateProject(state, input) {
  assertIdleWorkspace(state);
  state.workspaces.push(captureProject(state));
  const project = {
    project: { id: `project-${randomUUID()}`, title: input.title, subtitle: input.direction, stage: 'planning' },
    head: null, scenes: [], feedback: [], candidates: [], changeSets: [], evaluationReports: [], mergePreviews: [], plans: [], runs: [], jobs: [], runEvents: [],
    drafts: {}, dependencies: [], contextVersion: 0, editions: [],
  };
  const snapshot = makeSnapshot(project, 'New project');
  project.head = snapshot.id;
  project.snapshots = [snapshot];
  initializeProjectBranches(project);
  for (const key of projectFields) state[key] = project[key];
  appendEvent(state, 'project.created', { projectId: state.project.id });
  return { ...state.project, currentBranchId: state.currentBranchId };
}

export function switchProject(state, projectId) {
  assertIdleWorkspace(state);
  const index = state.workspaces.findIndex((workspace) => workspace.project.id === projectId);
  if (index < 0) throw new DomainError('NOT_FOUND', 'Project not found.', 404);
  const target = state.workspaces[index];
  initializeProjectBranches(target);
  state.workspaces.splice(index, 1, captureProject(state));
  for (const key of projectFields) state[key] = structuredClone(target[key]);
  validateBranches(state);
  appendEvent(state, 'project.switched', { projectId, humanRequested: true });
  return publicState(state);
}
