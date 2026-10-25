import { createHash, randomUUID } from 'node:crypto';
import { canonicalJson } from '../packages/domain/canonical.mjs';
import { activeBranch } from './branch-state.mjs';
import { ancestorIds } from '../packages/revision/ancestry.mjs';
import { workspaceHash } from '../packages/revision/workspace.mjs';
import { DomainError } from './errors.mjs';

export const narrativeContext = (state) => structuredClone({
  plans: state.plans, dependencies: state.dependencies, contextVersion: state.contextVersion ?? 0,
});

export function makeSnapshot(state, label, options = {}) {
  const sceneTexts = Object.fromEntries(state.scenes.map((scene) => [scene.id, scene.text]));
  const sceneManifest = state.scenes.map(({ text, ...metadata }) => structuredClone(metadata));
  const context = narrativeContext(state);
  const lineage = { parentSnapshotId: state.head ?? null, mergeParentSnapshotId: options.mergeParentSnapshotId ?? null,
    mergeSource: options.mergeSource ? structuredClone(options.mergeSource) : null };
  if (lineage.mergeParentSnapshotId && !state.snapshots.some(({ id }) => id === lineage.mergeParentSnapshotId)) {
    throw new DomainError('SNAPSHOT_ANCESTRY_INCOMPLETE', 'The merge parent snapshot is missing.', 409);
  }
  const canonicalHash = workspaceHash(state);
  return { id: `snapshot-${randomUUID()}`, schemaVersion: 3, ...lineage, workspaceHash: canonicalHash,
    label, createdAt: new Date().toISOString(), sceneTexts, sceneManifest, narrativeContext: context,
    manifestHash: createHash('sha256').update(canonicalJson({ sceneTexts, sceneManifest, narrativeContext: context, ...lineage, workspaceHash: canonicalHash })).digest('hex') };
}

export function advanceSnapshot(state, label, options = {}) {
  const snapshot = makeSnapshot(state, label, options);
  const branch = activeBranch(state);
  state.snapshots.push(snapshot);
  if (snapshot.mergeParentSnapshotId) branch.snapshotIds = ancestorIds(state, snapshot.id);
  else branch.snapshotIds.push(snapshot.id);
  branch.headSnapshotId = snapshot.id;
  state.head = snapshot.id;
  return snapshot;
}
