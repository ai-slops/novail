import { createHash, randomUUID } from 'node:crypto';
import { canonicalJson } from '../packages/domain/canonical.mjs';
import { activeBranch } from './branch-state.mjs';

export const narrativeContext = (state) => structuredClone({
  plans: state.plans, dependencies: state.dependencies, contextVersion: state.contextVersion ?? 0,
});

export function makeSnapshot(state, label) {
  const sceneTexts = Object.fromEntries(state.scenes.map((scene) => [scene.id, scene.text]));
  const sceneManifest = state.scenes.map(({ text, ...metadata }) => structuredClone(metadata));
  const context = narrativeContext(state);
  return { id: `snapshot-${randomUUID()}`, schemaVersion: 2, parentSnapshotId: state.head ?? null,
    label, createdAt: new Date().toISOString(), sceneTexts, sceneManifest, narrativeContext: context,
    manifestHash: createHash('sha256').update(canonicalJson({ sceneTexts, sceneManifest, narrativeContext: context })).digest('hex') };
}

export function advanceSnapshot(state, label) {
  const snapshot = makeSnapshot(state, label);
  const branch = activeBranch(state);
  state.snapshots.push(snapshot);
  branch.snapshotIds.push(snapshot.id);
  branch.headSnapshotId = snapshot.id;
  state.head = snapshot.id;
  return snapshot;
}
