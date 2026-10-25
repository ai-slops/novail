import { createHash, randomUUID } from 'node:crypto';
import { canonicalJson } from '../domain/canonical.mjs';
import { DomainError } from '../../app/errors.mjs';
import { ancestorIds, findMergeBase } from './ancestry.mjs';
import { buildMergeItems, resolveMergeItems } from './merge-items.mjs';
import { canonicalWorkspace, workspaceFromSnapshot, workspaceHash } from './workspace.mjs';
import { createChangeSet } from './changesets.mjs';

const equal = (left, right) => canonicalJson(left) === canonicalJson(right);
const digest = (value) => createHash('sha256').update(canonicalJson(value)).digest('hex');

function requireBranch(state, id) {
  const branch = state.branches.find((candidate) => candidate.id === id);
  if (!branch) throw new DomainError('NOT_FOUND', 'Branch to merge not found.', 404);
  return branch;
}

function assertSourceIdle(source) {
  if (!Array.isArray(source.workspace?.runs)) {
    throw new DomainError('MERGE_SOURCE_STATE_INVALID', 'The source branch run state cannot be verified.', 409);
  }
  if (source.workspace.runs.some(({ state }) => ['queued', 'running', 'paused'].includes(state))) {
    throw new DomainError('MERGE_SOURCE_ACTIVE', 'Complete or cancel active work in the source branch first.', 409);
  }
}

function publicPreview(preview) {
  const { auditInputs, privateItems, ...visible } = preview;
  return structuredClone(visible);
}

function previewHash(preview) {
  const { hash, ...bound } = preview;
  return digest(bound);
}

function rejectIncludedSource(state, source, sourceWorkspace, targetHead) {
  const reachable = new Set(ancestorIds(state, targetHead));
  const prior = state.snapshots.some((snapshot) => reachable.has(snapshot.id)
    && snapshot.mergeSource?.branchId === source.id
    && snapshot.mergeSource?.headSnapshotId === source.headSnapshotId
    && snapshot.mergeSource?.workspaceHash === workspaceHash(sourceWorkspace));
  if (prior) throw new DomainError('MERGE_ALREADY_INCLUDED', 'This source workspace has already been merged into the target lineage.', 409);

  if (reachable.has(source.headSnapshotId)) {
    const sourceSnapshot = state.snapshots.find(({ id }) => id === source.headSnapshotId);
    const snapshotted = workspaceFromSnapshot(sourceSnapshot);
    const hasUncheckpointedContext = !snapshotted.contextKnown || !equal(sourceWorkspace, snapshotted.workspace);
    if (!hasUncheckpointedContext) throw new DomainError('MERGE_ALREADY_INCLUDED', 'The source base version is already included in the target lineage.', 409);
  }
}

export function createMergePreview(state, input) {
  const target = requireBranch(state, state.currentBranchId);
  const source = requireBranch(state, input.sourceBranchId);
  if (source.id === target.id) throw new DomainError('MERGE_SELF', 'A branch cannot be merged into itself.', 409);
  if (!source.workspace) throw new DomainError('BRANCH_STATE_INVALID', 'The source branch must be an inactive workspace.', 409);
  assertSourceIdle(source);
  if (state.head !== input.expectedHead || target.headSnapshotId !== input.expectedHead) {
    throw new DomainError('STALE_HEAD', 'The target base version changed.', 409);
  }
  const targetWorkspace = canonicalWorkspace(state);
  if (workspaceHash(targetWorkspace) !== input.baseWorkspaceHash) {
    throw new DomainError('STALE_WORKSPACE', 'The target workspace changed.', 409);
  }
  const sourceWorkspace = canonicalWorkspace(source.workspace);
  rejectIncludedSource(state, source, sourceWorkspace, target.headSnapshotId);
  const sourceIsAncestor = ancestorIds(state, target.headSnapshotId).includes(source.headSnapshotId);
  if (sourceIsAncestor && equal(sourceWorkspace, targetWorkspace)) {
    throw new DomainError('MERGE_ALREADY_INCLUDED', 'The same source workspace is already included in the target.', 409);
  }

  const baseSnapshot = findMergeBase(state, source.headSnapshotId, target.headSnapshotId);
  const base = workspaceFromSnapshot(baseSnapshot);
  const privateItems = buildMergeItems(base.workspace, sourceWorkspace, targetWorkspace, base.contextKnown);
  const items = privateItems.map(({ protectionRequirements, ...item }) => item);
  const preview = {
    id: `merge-preview-${randomUUID()}`, projectId: state.project.id,
    targetBranchId: target.id, targetHead: target.headSnapshotId, targetWorkspaceHash: workspaceHash(targetWorkspace),
    sourceBranchId: source.id, sourceHead: source.headSnapshotId, sourceWorkspaceHash: workspaceHash(sourceWorkspace),
    baseSnapshotId: baseSnapshot.id, sourceName: source.name, targetName: target.name, items,
    createdAt: new Date().toISOString(),
    auditInputs: { base: base.workspace, source: sourceWorkspace, target: targetWorkspace, contextKnown: base.contextKnown },
    privateItems,
  };
  preview.hash = previewHash(preview);
  state.mergePreviews ??= [];
  state.mergePreviews.push(structuredClone(preview));
  return publicPreview(preview);
}

export function getMergePreview(state, previewId) {
  const preview = (state.mergePreviews ?? []).find(({ id, targetBranchId }) => id === previewId && targetBranchId === state.currentBranchId);
  if (!preview) throw new DomainError('NOT_FOUND', 'Merge preview not found.', 404);
  return publicPreview(preview);
}

export function resolveMergePreview(state, visiblePreview, resolutions) {
  const stored = (state.mergePreviews ?? []).find(({ id }) => id === visiblePreview.id);
  if (!stored || stored.hash !== visiblePreview.hash || previewHash(stored) !== stored.hash) {
    throw new DomainError('MERGE_PREVIEW_STALE', 'The merge preview changed or is invalid.', 409);
  }
  return resolveMergeItems(stored.auditInputs.target, stored.privateItems, resolutions);
}

export function assertMergePreviewCurrent(state, preview) {
  const source = requireBranch(state, preview.sourceBranchId);
  assertSourceIdle(source);
  if (state.currentBranchId !== preview.targetBranchId || state.head !== preview.targetHead
    || workspaceHash(state) !== preview.targetWorkspaceHash
    || source.headSnapshotId !== preview.sourceHead || !source.workspace
    || workspaceHash(source.workspace) !== preview.sourceWorkspaceHash) {
    throw new DomainError('MERGE_PREVIEW_STALE', 'The source or target workspace changed after the preview.', 409);
  }
  return source;
}

export function sealMergePreview(state, previewId, input) {
  const stored = (state.mergePreviews ?? []).find(({ id, targetBranchId }) => id === previewId && targetBranchId === state.currentBranchId);
  if (!stored) throw new DomainError('NOT_FOUND', 'Merge preview not found.', 404);
  if (input.previewHash !== stored.hash || previewHash(stored) !== stored.hash) {
    throw new DomainError('MERGE_PREVIEW_STALE', 'The approved merge preview hash does not match.', 409);
  }
  assertMergePreviewCurrent(state, stored);
  const resolved = resolveMergeItems(stored.auditInputs.target, stored.privateItems, input.resolutions);
  const protectionRequirements = Object.fromEntries(stored.privateItems
    .filter(({ protectionRequirements }) => protectionRequirements?.length)
    .map(({ key, protectionRequirements }) => [key, structuredClone(protectionRequirements)]));
  return createChangeSet(state, {
    kind: 'merge', reason: `${stored.sourceName} → ${stored.targetName} merge${workspaceHash(resolved.workspace) === stored.targetWorkspaceHash ? ' (merge history only, with no manuscript changes)' : ''}`, changes: resolved.changes,
    baseSnapshotId: stored.targetHead, baseWorkspaceHash: stored.targetWorkspaceHash,
    feedbackIds: [], runId: null, candidateId: null, parentChangeSetId: null, atomic: true,
    merge: {
      previewId: stored.id, previewHash: stored.hash, sourceBranchId: stored.sourceBranchId,
      sourceHead: stored.sourceHead, sourceWorkspaceHash: stored.sourceWorkspaceHash,
      targetWorkspaceHash: stored.targetWorkspaceHash, baseSnapshotId: stored.baseSnapshotId,
      sourceWorkspace: structuredClone(stored.auditInputs.source),
      resolutions: structuredClone(input.resolutions), protectionRequirements,
    },
  });
}
