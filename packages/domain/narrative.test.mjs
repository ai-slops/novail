import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkReadiness, checkTemporalConstraints, validateSpan, toCodePointOffset } from './narrative.ts';

const ready = {
  generationKind: 'draft', baseSnapshotId: 'snapshot', openDecisions: [],
  conditions: [], requiredTokens: 200, tokenBudget: 1000,
};

test('draft is held when an open decision changes the block', () => {
  const input = { ...ready, openDecisions: [{ id: 'culprit', affectsBlock: true }] };
  const result = checkReadiness(input);
  assert.equal(result.ready, false);
  assert.equal(result.blockers[0].code, 'OPEN_DECISION');
});

test('exploration permits an unresolved narrative decision', () => {
  const input = { ...ready, generationKind: 'exploration', openDecisions: [{ id: 'ending', affectsBlock: true }] };
  const result = checkReadiness(input);
  assert.equal(result.ready, true);
});

test('exploration never bypasses disclosure restrictions', () => {
  const input = { ...ready, generationKind: 'exploration', conditions: [{ id: 'secret', kind: 'disclosure', status: 'fail' }] };
  const result = checkReadiness(input);
  assert.equal(result.ready, false);
});

test('required context over budget blocks instead of truncating', () => {
  const input = { ...ready, requiredTokens: 1001 };
  const result = checkReadiness(input);
  assert.equal(result.blockers[0].code, 'BLOCKED_CONTEXT_BUDGET');
});

test('Korean span after astral character uses code points', () => {
  const input = { text: '밤🌙리아', startCp: 2, endCp: 4, quote: '리아' };
  const result = validateSpan(input);
  assert.equal(result.valid, true);
});

test('mismatched quote remains unresolved', () => {
  const result = validateSpan({ text: '밤🌙리아', startCp: 1, endCp: 3, quote: '리아' });
  assert.equal(result.code, 'ANCHOR_UNRESOLVED');
});

test('browser UTF16 position converts to code point offset', () => {
  const result = toCodePointOffset('밤🌙리아', 3);
  assert.deepEqual(result, { valid: true, offset: 2 });
});

test('position splitting a surrogate pair is rejected', () => {
  const result = toCodePointOffset('밤🌙리아', 2);
  assert.equal(result.valid, false);
});

test('contradictory temporal cycle returns constraint IDs', () => {
  const edges = [
    { id: 'a', from: 'arrival', to: 'departure', relation: 'before', minElapsed: 0 },
    { id: 'b', from: 'departure', to: 'arrival', relation: 'before', minElapsed: 0 },
  ];
  const result = checkTemporalConstraints(edges);
  assert.equal(result.verdict, 'fail');
  assert.deepEqual(new Set(result.conflicts), new Set(['a', 'b']));
});

test('convergent temporal dependencies are not a contradiction', () => {
  const edges = [
    { id: 'a', from: 'a', to: 'c', relation: 'before', minElapsed: 0 },
    { id: 'b', from: 'b', to: 'c', relation: 'min_elapsed', minElapsed: 3 },
  ];
  const result = checkTemporalConstraints(edges);
  assert.equal(result.verdict, 'pass');
});

test('overlap without durations remains unknown', () => {
  const result = checkTemporalConstraints([{ id: 'a', from: 'a', to: 'b', relation: 'overlaps', minElapsed: 0 }]);
  assert.equal(result.verdict, 'unknown');
});
