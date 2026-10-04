import assert from 'node:assert/strict';
import test from 'node:test';

import { createMergePreview, resolveMergePreview, sealMergePreview } from '../packages/revision/merges.mjs';
import { changeSetHash } from '../packages/revision/change-set-hash.mjs';
import { workspaceHash } from '../packages/revision/workspace.mjs';

const scene = (id, text, protectedQuotes = []) => ({
  id, title: id, chapter: Number(id.replace(/\D/g, '')) || 1, status: 'canon', text,
  summary: id, storyTime: 'now', characters: [], protectedQuotes,
});

function snapshot(id, parentSnapshotId, scenes, context = { plans: [], dependencies: [], contextVersion: 0 }) {
  return {
    id, parentSnapshotId, sceneTexts: Object.fromEntries(scenes.map((item) => [item.id, item.text])),
    sceneManifest: scenes.map(({ text, ...metadata }) => metadata), narrativeContext: context,
  };
}

function fixture({ baseScenes, sourceScenes, targetScenes, sourcePlans = [], targetPlans = [], sourceLayout, targetLayout }) {
  const base = snapshot('base', null, baseScenes);
  const sourceHead = snapshot('source-head', 'base', sourceScenes, { plans: sourcePlans, dependencies: [], contextVersion: 1 });
  const targetHead = snapshot('target-head', 'base', targetScenes, { plans: targetPlans, dependencies: [], contextVersion: 1 });
  const sourceWorkspace = { scenes: sourceScenes, plans: sourcePlans, dependencies: [], layout: sourceLayout ?? sourceScenes.map(({ id }) => id), runs: [] };
  const state = {
    project: { id: 'project' }, currentBranchId: 'target', head: 'target-head', snapshots: [base, sourceHead, targetHead],
    scenes: targetScenes, plans: targetPlans, dependencies: [], layout: targetLayout ?? targetScenes.map(({ id }) => id),
    mergePreviews: [], changeSets: [], feedback: [], runs: [], audit: [], outbox: [], contextVersion: 1,
    branches: [
      { id: 'target', name: 'Target', headSnapshotId: 'target-head', snapshotIds: ['base', 'target-head'] },
      { id: 'source', name: 'Source', headSnapshotId: 'source-head', snapshotIds: ['base', 'source-head'], workspace: sourceWorkspace },
    ],
  };
  return state;
}

const preview = (state) => createMergePreview(state, {
  sourceBranchId: 'source', expectedHead: state.head, baseWorkspaceHash: workspaceHash(state),
});

test('Given clean source scene changes and target-only changes, when previewed, then source changes are incoming and target-only content is preserved', () => {
  const base = [scene('scene-1', 'base one'), scene('scene-2', 'base two')];
  const state = fixture({
    baseScenes: base,
    sourceScenes: [scene('scene-1', 'source one'), scene('scene-2', 'base two')],
    targetScenes: [scene('scene-1', 'base one'), scene('scene-2', 'target two')],
  });

  const result = preview(state);

  assert.deepEqual(result.items.filter(({ kind }) => kind === 'scene').map(({ key, conflict }) => [key, conflict]), [['scene:scene-1', false]]);
  const resolved = resolveMergePreview(state, result, []);
  assert.equal(resolved.workspace.scenes.find(({ id }) => id === 'scene-1').text, 'source one');
  assert.equal(resolved.workspace.scenes.find(({ id }) => id === 'scene-2').text, 'target two');
});

test('Given a clean incoming item, when the client explicitly sends source or custom, then both known choices are accepted', () => {
  for (const [resolution, expected] of [
    [{ key: 'scene:scene-1', choice: 'source' }, 'source'],
    [{ key: 'scene:scene-1', choice: 'custom', change: { kind: 'scene', artifactId: 'scene-1', after: scene('scene-1', 'custom') } }, 'custom'],
  ]) {
    const state = fixture({ baseScenes: [scene('scene-1', 'base')], sourceScenes: [scene('scene-1', 'source')], targetScenes: [scene('scene-1', 'base')] });
    const result = preview(state);

    const resolved = resolveMergePreview(state, result, [resolution]);

    assert.equal(resolved.workspace.scenes[0].text, expected);
  }
});

test('Given both branches edit a scene, when resolving, then source, target, and custom choices produce exact results', () => {
  for (const [choice, expected] of [['source', 'source'], ['target', 'target'], ['custom', 'custom']]) {
    const state = fixture({ baseScenes: [scene('scene-1', 'base')], sourceScenes: [scene('scene-1', 'source')], targetScenes: [scene('scene-1', 'target')] });
    const result = preview(state);
    const resolution = choice === 'custom'
      ? { key: 'scene:scene-1', choice, change: { kind: 'scene', artifactId: 'scene-1', after: scene('scene-1', 'custom') } }
      : { key: 'scene:scene-1', choice };

    const resolved = resolveMergePreview(state, result, [resolution]);

    assert.equal(resolved.workspace.scenes[0].text, expected);
  }
});

test('Given additions and deletions, when layout is resolved, then priority is filtered and missing surviving scenes append deterministically', () => {
  const state = fixture({
    baseScenes: [scene('scene-1', 'one'), scene('scene-2', 'two')],
    sourceScenes: [scene('scene-2', 'two'), scene('scene-3', 'three')],
    targetScenes: [scene('scene-1', 'one'), scene('scene-2', 'two'), scene('scene-4', 'four')],
    sourceLayout: ['scene-3', 'scene-2'], targetLayout: ['scene-4', 'scene-1', 'scene-2'],
  });
  const result = preview(state);

  const resolved = resolveMergePreview(state, result, [{ key: 'layout:reading-order', choice: 'source' }]);

  assert.deepEqual(resolved.workspace.layout, ['scene-3', 'scene-2', 'scene-4']);
});

test('Given protected text from any known side, when a resolution removes protection or deletes its scene, then sealing is rejected', () => {
  const protectedScene = scene('scene-1', 'keep this', ['keep this']);
  const state = fixture({ baseScenes: [protectedScene], sourceScenes: [protectedScene], targetScenes: [scene('scene-1', 'changed', [])] });
  const result = preview(state);

  assert.throws(() => resolveMergePreview(state, result, [{ key: 'scene:scene-1', choice: 'target' }]), (error) => error.code === 'MERGE_PROTECTION_VIOLATION');
});

test('Given a custom scene with added protections, when resolved, then known and custom protections are retained and validated', () => {
  const state = fixture({
    baseScenes: [scene('scene-1', 'known custom', ['known'])],
    sourceScenes: [scene('scene-1', 'source known custom', ['known'])],
    targetScenes: [scene('scene-1', 'target known custom', ['known'])],
  });
  const result = preview(state);
  const change = { kind: 'scene', artifactId: 'scene-1', after: scene('scene-1', 'known custom', ['custom']) };

  const resolved = resolveMergePreview(state, result, [{ key: 'scene:scene-1', choice: 'custom', change }]);

  assert.deepEqual(resolved.workspace.scenes[0].protectedQuotes, ['custom', 'known']);
  change.after.protectedQuotes = ['missing'];
  assert.throws(() => resolveMergePreview(state, result, [{ key: 'scene:scene-1', choice: 'custom', change }]), (error) => error.code === 'MERGE_PROTECTION_VIOLATION');
});

test('Given unknown legacy base context, when plans differ, then the preview labels base unknown and requires an explicit resolution', () => {
  const state = fixture({
    baseScenes: [scene('scene-1', 'base')], sourceScenes: [scene('scene-1', 'base')], targetScenes: [scene('scene-1', 'base')],
    sourcePlans: [{ id: 'plan-1', title: 'Source', kind: 'plot', description: 'source', status: 'active' }], targetPlans: [],
  });
  delete state.snapshots[0].narrativeContext;

  const result = preview(state);
  const item = result.items.find(({ kind }) => kind === 'plan');

  assert.equal(item.baseKnown, false);
  assert.equal(item.base, null);
  assert.throws(() => resolveMergePreview(state, result, []), (error) => error.code === 'MERGE_RESOLUTION_REQUIRED');
});

test('Given a resolved immutable preview, when it is sealed, then an atomic merge change set binds both current inputs without changing source', () => {
  const state = fixture({ baseScenes: [scene('scene-1', 'base')], sourceScenes: [scene('scene-1', 'source')], targetScenes: [scene('scene-1', 'target')] });
  const result = preview(state);
  const sourceBefore = structuredClone(state.branches[1]);

  const changeSet = sealMergePreview(state, result.id, {
    previewHash: result.hash, resolutions: [{ key: 'scene:scene-1', choice: 'source' }],
  });

  assert.equal(changeSet.kind, 'merge');
  assert.equal(changeSet.merge.previewHash, result.hash);
  assert.equal(changeSet.merge.sourceHead, 'source-head');
  assert.equal(changeSet.bundles.length, 1);
  assert.deepEqual(state.branches[1], sourceBefore);
});

test('Given a custom sealed result, when its custom payload is altered before approval, then the immutable change-set hash no longer matches', () => {
  const state = fixture({ baseScenes: [scene('scene-1', 'base')], sourceScenes: [scene('scene-1', 'source')], targetScenes: [scene('scene-1', 'target')] });
  const result = preview(state);
  const changeSet = sealMergePreview(state, result.id, {
    previewHash: result.hash,
    resolutions: [{ key: 'scene:scene-1', choice: 'custom', change: { kind: 'scene', artifactId: 'scene-1', after: scene('scene-1', 'custom') } }],
  });

  const stored = state.changeSets.find(({ id }) => id === changeSet.id);
  stored.merge.resolutions[0].change.after.text = 'tampered';

  assert.notEqual(changeSetHash(stored), stored.hash);
});

test('Given an inactive source with active work, when previewing or sealing, then merge transport rejects the unsafe source state', () => {
  const state = fixture({ baseScenes: [scene('scene-1', 'base')], sourceScenes: [scene('scene-1', 'source')], targetScenes: [scene('scene-1', 'base')] });
  state.branches[1].workspace.runs.push({ id: 'run-1', state: 'running' });
  assert.throws(() => preview(state), (error) => error.code === 'MERGE_SOURCE_ACTIVE');

  state.branches[1].workspace.runs = [];
  const result = preview(state);
  state.branches[1].workspace.runs.push({ id: 'run-2', state: 'queued' });
  assert.throws(() => sealMergePreview(state, result.id, { previewHash: result.hash, resolutions: [{ key: 'scene:scene-1', choice: 'source' }] }),
    (error) => error.code === 'MERGE_SOURCE_ACTIVE');
});
