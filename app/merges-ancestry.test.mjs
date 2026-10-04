import assert from 'node:assert/strict';
import test from 'node:test';

import { ancestorIds, findMergeBase } from '../packages/revision/ancestry.mjs';

const state = (snapshots) => ({ snapshots });

test('Given legacy snapshots before explicit ancestry, when ancestors are read, then only the known prefix is inferred', () => {
  const catalog = state([
    { id: 'root' },
    { id: 'legacy-child' },
    { id: 'explicit-child', parentSnapshotId: 'legacy-child' },
    { id: 'unknown-parent' },
  ]);

  assert.deepEqual(ancestorIds(catalog, 'explicit-child'), ['root', 'legacy-child', 'explicit-child']);
  assert.throws(() => ancestorIds(catalog, 'unknown-parent'), (error) => error.code === 'SNAPSHOT_ANCESTRY_INCOMPLETE');
});

test('Given a merge DAG, when ancestors are read, then both parents are included once in catalog order', () => {
  const catalog = state([
    { id: 'root', parentSnapshotId: null },
    { id: 'left', parentSnapshotId: 'root' },
    { id: 'right', parentSnapshotId: 'root' },
    { id: 'merge', parentSnapshotId: 'left', mergeParentSnapshotId: 'right' },
  ]);

  assert.deepEqual(ancestorIds(catalog, 'merge'), ['root', 'left', 'right', 'merge']);
});

test('Given malformed ancestry, when it is traversed, then missing parents and cycles are rejected', () => {
  const missing = state([{ id: 'head', parentSnapshotId: 'absent' }]);
  const cyclic = state([
    { id: 'a', parentSnapshotId: 'b' },
    { id: 'b', parentSnapshotId: 'a' },
  ]);

  assert.throws(() => ancestorIds(missing, 'head'), (error) => error.code === 'SNAPSHOT_ANCESTRY_INCOMPLETE');
  assert.throws(() => ancestorIds(cyclic, 'a'), (error) => error.code === 'SNAPSHOT_ANCESTRY_CYCLE');
});

test('Given a criss-cross DAG, when a merge base is requested, then ambiguous maximal bases are rejected', () => {
  const catalog = state([
    { id: 'root', parentSnapshotId: null },
    { id: 'a1', parentSnapshotId: 'root' },
    { id: 'b1', parentSnapshotId: 'root' },
    { id: 'a2', parentSnapshotId: 'a1', mergeParentSnapshotId: 'b1' },
    { id: 'b2', parentSnapshotId: 'b1', mergeParentSnapshotId: 'a1' },
  ]);

  assert.throws(() => findMergeBase(catalog, 'a2', 'b2'), (error) => error.code === 'MERGE_BASE_AMBIGUOUS');
});

test('Given an ordinary DAG, when a merge base is requested, then the unique maximal common snapshot is returned', () => {
  const catalog = state([
    { id: 'root', parentSnapshotId: null },
    { id: 'shared', parentSnapshotId: 'root' },
    { id: 'source', parentSnapshotId: 'shared' },
    { id: 'target', parentSnapshotId: 'shared' },
  ]);

  assert.equal(findMergeBase(catalog, 'source', 'target').id, 'shared');
});
