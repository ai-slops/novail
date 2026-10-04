import { test } from 'node:test';
import assert from 'node:assert/strict';
import { candidateHash } from '../../app/domain.mjs';
import { canonicalJson } from './canonical.mjs';

test('candidate approval hash survives PostgreSQL JSONB key reordering', () => {
  const candidate = {
    sceneId: 'scene', baseSnapshotId: 'base', before: '원문', after: '후보',
    rewriteSet: ['scene'],
    reviewSet: [{ sceneId: 'distant', title: '회수', reason: '약속', mandatory: true }],
  };
  const reordered = JSON.parse(canonicalJson(candidate));
  assert.equal(candidateHash(candidate), candidateHash(reordered));
});

test('canonical JSON retains array order because presentation order is meaningful', () => {
  assert.notEqual(canonicalJson(['a', 'b']), canonicalJson(['b', 'a']));
});
