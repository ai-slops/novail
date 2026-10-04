import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSeed } from '../app/seed.mjs';
import { publicState } from '../app/domain.mjs';
import { editionSummarySchema, exportPreviewSchema, workspaceSchema } from './schema.ts';
import { branchHeaders, snapshotExportUrl } from './api-contract.ts';

test('API numeric chapter parses into a readable frontend chapter label', () => {
  const response = publicState(createSeed());
  const parsed = workspaceSchema.parse(response);
  assert.equal(parsed.scenes.find((scene) => scene.id === 'scene-7').chapter, '7장');
});

test('legacy state without editions parses with an empty edition ledger', () => {
  const response = publicState(createSeed());
  delete response.editions;
  delete response.currentBranchId;
  delete response.branches;
  response.snapshots = response.snapshots.map(({ canBranch: _canBranch, ...snapshot }) => snapshot);
  const parsed = workspaceSchema.parse(response);
  assert.deepEqual(parsed.editions, []);
  assert.equal(parsed.currentBranchId, '');
  assert.deepEqual(parsed.branches, []);
  assert.equal(parsed.snapshots[0]?.canBranch, false);
});

test('branch-aware workspace parses branch identity, lineage, and branchable snapshots', () => {
  const response = publicState(createSeed());
  response.currentBranchId = 'branch-main';
  response.branches = [{ id: 'branch-main', name: '기본 작업선', headSnapshotId: response.head, sourceSnapshotId: response.head, sourceBranchId: null, createdAt: '2026-10-03T00:00:00.000Z', isCurrent: true, snapshotCount: response.snapshots.length }];
  response.snapshots = response.snapshots.map((snapshot, index) => ({ ...snapshot, canBranch: index === response.snapshots.length - 1 }));
  const parsed = workspaceSchema.parse(response);
  assert.equal(parsed.currentBranchId, 'branch-main');
  assert.equal(parsed.branches[0]?.sourceBranchId, null);
  assert.equal(parsed.snapshots.at(-1)?.canBranch, true);
});

test('edition branch source is additive and legacy-safe', () => {
  const base = { id: 'edition-1', title: '초판', snapshotId: 'snapshot-1', manifestHash: 'c'.repeat(64), createdAt: '2026-09-22T00:00:00.000Z', publishedBy: 'local-owner', revisionOf: null, sceneCount: 1 };
  assert.equal(editionSummarySchema.parse(base).sourceBranchId, null);
  assert.equal(editionSummarySchema.parse({ ...base, sourceBranchId: 'branch-main' }).sourceBranchId, 'branch-main');
});

test('branch-scoped requests use explicit headers and snapshot export query scope', () => {
  assert.deepEqual(branchHeaders('branch-main'), { 'X-Novail-Branch-Id': 'branch-main' });
  assert.equal(snapshotExportUrl('snapshot 1', 'markdown', 'branch/main'), '/api/export?snapshotId=snapshot%201&branchId=branch%2Fmain&format=markdown');
});

test('export preview parses immutable manifest and predecessor metadata', () => {
  const parsed = exportPreviewSchema.parse({
    projectId: 'project-1', snapshotId: 'snapshot-2', manifestHash: 'a'.repeat(64), sceneCount: 1,
    characterCount: 120, title: '푸른 인장의 밤', subtitle: '장편소설',
    scenes: [{ id: 'scene-1', chapter: 1, title: '봉쇄', textHash: 'b'.repeat(64), characters: 120 }],
    latestEdition: { id: 'edition-1', title: '초판', snapshotId: 'snapshot-1', manifestHash: 'c'.repeat(64), createdAt: '2026-09-22T00:00:00.000Z', publishedBy: 'local-owner', revisionOf: null, sceneCount: 1 },
  });
  assert.equal(parsed.latestEdition?.manifestHash, 'c'.repeat(64));
  assert.equal(parsed.scenes[0]?.chapter, 1);
});
