import assert from 'node:assert/strict';
import test from 'node:test';
import { branchFixture, command, createBranch, readState, switchBranch } from './branch-test-support.mjs';

async function revise(app, text) {
  const state = await readState(app);
  const context = await (await app.request('/api/revision-context')).json();
  const scene = context.workspace.scenes.find((item) => item.id === 'scene-7');
  const response = await command(app, '/api/change-sets', { baseSnapshotId: state.head,
    baseWorkspaceHash: context.workspaceHash, reason: '검증 개정', feedbackIds: [], atomic: false,
    changes: [{ kind: 'scene', artifactId: scene.id, after: { ...scene, text } }] }, { branchId: state.currentBranchId });
  assert.equal(response.status, 201);
  const proposal = await response.json();
  const commit = await command(app, `/api/change-sets/${proposal.id}/commit`, { expectedHead: state.head,
    approvedHash: proposal.hash, reviewedKeys: proposal.requiredReviewKeys, decision: 'accept', policyVersion: 2 }, { branchId: state.currentBranchId });
  assert.equal(commit.status, 200);
  return readState(app);
}

async function divergent(t, sameText = false) {
  const fixture = await branchFixture(t);
  const main = await readState(fixture.app);
  const original = main.scenes.find((scene) => scene.id === 'scene-7').text;
  const { branch } = await createBranch(fixture.app, main, '병합 소스');
  const target = await revise(fixture.app, `${original}\n대상 결말.`);
  await switchBranch(fixture.app, target, branch.id);
  const source = await revise(fixture.app, `${original}\n${sameText ? '대상' : '출처'} 결말.`);
  await switchBranch(fixture.app, source, main.currentBranchId);
  return { ...fixture, original, target, source, sourceId: branch.id };
}

async function preview(fixture) {
  const state = await readState(fixture.app);
  const response = await command(fixture.app, '/api/merge-previews', { sourceBranchId: fixture.sourceId,
    expectedHead: state.head, baseWorkspaceHash: state.workspaceHash }, { branchId: state.currentBranchId });
  assert.equal(response.status, 201);
  return response.json();
}

test('resolved merge commits both parents, preserves source, and forks the true source ancestry', async (t) => {
  const fixture = await divergent(t);
  const proposal = await preview(fixture);
  const resolutions = proposal.items.map((item) => item.kind === 'scene' ? { key: item.key, choice: 'custom',
    change: { kind: 'scene', artifactId: item.artifactId, after: { ...item.target, text: `${fixture.original}\n합의한 결말.` } } }
    : { key: item.key, choice: 'target' });
  const state = await readState(fixture.app);
  const sealedResponse = await command(fixture.app, `/api/merge-previews/${proposal.id}/seal`, { previewHash: proposal.hash, resolutions }, { branchId: state.currentBranchId });
  assert.equal(sealedResponse.status, 201);
  const sealed = await sealedResponse.json();
  const adopted = await command(fixture.app, `/api/change-sets/${sealed.id}/commit`, { expectedHead: state.head,
    approvedHash: sealed.hash, reviewedKeys: sealed.requiredReviewKeys, decision: 'accept', policyVersion: 2 }, { branchId: state.currentBranchId });
  assert.equal(adopted.status, 200);
  const result = await adopted.json();
  assert.equal(result.snapshot.parentSnapshotId, fixture.target.head);
  assert.equal(result.snapshot.mergeParentSnapshotId, fixture.source.head);
  const stored = await fixture.store.read();
  assert.ok(stored.branches.find((branch) => branch.id === fixture.sourceId).workspace.scenes.find((scene) => scene.id === 'scene-7').text.endsWith('출처 결말.'));
  const merged = await readState(fixture.app);
  assert.ok(merged.snapshots.some((snapshot) => snapshot.id === fixture.source.head));
  const { branch } = await createBranch(fixture.app, merged, '소스 시점 분기', fixture.source.head);
  await switchBranch(fixture.app, merged, branch.id);
  const forked = await readState(fixture.app);
  assert.equal(forked.snapshots.some((snapshot) => snapshot.id === fixture.target.head), false);
  assert.equal(forked.head, fixture.source.head);
});

test('a source workspace change after sealing invalidates merge even without source head advance', async (t) => {
  const fixture = await divergent(t);
  const proposal = await preview(fixture);
  const state = await readState(fixture.app);
  const sealed = await (await command(fixture.app, `/api/merge-previews/${proposal.id}/seal`, { previewHash: proposal.hash,
    resolutions: proposal.items.map((item) => ({ key: item.key, choice: 'source' })) }, { branchId: state.currentBranchId })).json();
  await switchBranch(fixture.app, state, fixture.sourceId);
  await command(fixture.app, '/api/plans', { title: '소스의 새 기획', kind: 'plot', description: '추가 맥락' }, { branchId: fixture.sourceId });
  const source = await readState(fixture.app);
  assert.equal(source.head, fixture.source.head);
  await switchBranch(fixture.app, source, state.currentBranchId);
  const rejected = await command(fixture.app, `/api/change-sets/${sealed.id}/commit`, { expectedHead: state.head,
    approvedHash: sealed.hash, reviewedKeys: sealed.requiredReviewKeys, decision: 'accept', policyVersion: 2 }, { branchId: state.currentBranchId });
  assert.equal(rejected.status, 409);
  assert.equal((await rejected.json()).error.code, 'STALE_MERGE_SOURCE');
  assert.equal((await readState(fixture.app)).head, state.head);
});

test('a no-content merge records ancestry once without rewriting manuscript', async (t) => {
  const fixture = await divergent(t, true);
  const proposal = await preview(fixture);
  const state = await readState(fixture.app);
  const sealedResponse = await command(fixture.app, `/api/merge-previews/${proposal.id}/seal`, { previewHash: proposal.hash, resolutions: [] }, { branchId: state.currentBranchId });
  assert.equal(sealedResponse.status, 201);
  const sealed = await sealedResponse.json();
  assert.equal(sealed.entries.length, 0);
  const adopted = await command(fixture.app, `/api/change-sets/${sealed.id}/commit`, { expectedHead: state.head,
    approvedHash: sealed.hash, reviewedKeys: [], decision: 'accept', policyVersion: 2 }, { branchId: state.currentBranchId });
  assert.equal(adopted.status, 200);
  const after = await readState(fixture.app);
  assert.equal(after.workspaceHash, state.workspaceHash);
  assert.notEqual(after.head, state.head);
  const repeated = await command(fixture.app, '/api/merge-previews', { sourceBranchId: fixture.sourceId,
    expectedHead: after.head, baseWorkspaceHash: after.workspaceHash }, { branchId: after.currentBranchId });
  assert.equal(repeated.status, 409);
  assert.equal((await repeated.json()).error.code, 'MERGE_ALREADY_INCLUDED');
});
