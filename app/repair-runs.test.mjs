import assert from 'node:assert/strict';
import test from 'node:test';
import { branchFixture, command, readState } from './branch-test-support.mjs';
import { createApplicationWorker } from './execution.mjs';
import { workspaceHash } from '../packages/revision/workspace.mjs';

test('multi-artifact repair creates one reviewed changeset without advancing canonical head', async (t) => {
  const oldKey = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  t.after(() => { if (oldKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = oldKey; });
  const { app, store } = await branchFixture(t);
  const state = await readState(app);
  const response = await command(app, '/api/repair-runs', {
    baseSnapshotId: state.head, baseWorkspaceHash: workspaceHash(await store.read()),
    instruction: 'Clarify the character choices', sceneIds: ['scene-1', 'scene-7'], planIds: ['plan-plot'], feedbackIds: [],
  }, { branchId: state.currentBranchId });
  assert.equal(response.status, 202);
  const run = await response.json();
  await createApplicationWorker(store).tick();
  const after = await store.read();
  assert.equal(after.head, state.head);
  const completed = after.runs.find((item) => item.id === run.id);
  assert.equal(completed.state, 'awaiting_decision');
  const proposal = after.changeSets.find((item) => item.id === completed.resultRef);
  assert.ok(proposal);
  assert.equal(proposal.kind, 'repair');
  assert.ok(proposal.entries.some((entry) => entry.kind === 'scene'));
  assert.ok(proposal.entries.some((entry) => entry.kind === 'plan'));
  assert.ok(proposal.reason.includes('Local example (not AI) · part fakeModel'));
  assert.deepEqual(after.runEvents.filter((event) => event.runId === run.id && event.type === 'runtime.tool.completed')
    .map((event) => event.details.toolId), [
    'novail_read_selected_scenes',
    'novail_read_selected_plans',
    'novail_read_readonly_context',
  ]);
});

test('cancelling repair reopens only feedback orphaned from live proposals', async (t) => {
  const oldKey = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  t.after(() => { if (oldKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = oldKey; });
  const { app, store } = await branchFixture(t);
  const state = await readState(app);
  const createFeedback = async (text) => (await (await command(app, '/api/feedback', {
    sceneId: 'scene-1', text, scope: 'scene',
  }, { branchId: state.currentBranchId })).json());
  const orphan = await createFeedback('고립된 제안을 취소하면 다시 검토');
  const shared = await createFeedback('다른 제안이 남으면 대기 유지');
  const closed = await createFeedback('사람이 닫은 상태 보존');
  const deferred = await createFeedback('사람이 미룬 상태 보존');
  const queueRepair = async (feedbackIds) => {
    const response = await command(app, '/api/repair-runs', {
      baseSnapshotId: state.head, baseWorkspaceHash: workspaceHash(await store.read()),
      instruction: '피드백에 맞춰 선택을 분명하게', sceneIds: ['scene-1'], planIds: [], feedbackIds,
    }, { branchId: state.currentBranchId });
    assert.equal(response.status, 202);
    return response.json();
  };
  const cancelledRun = await queueRepair([orphan.id, shared.id, closed.id, deferred.id]);
  await createApplicationWorker(store).tick();
  await store.transaction((draft) => {
    draft.feedback.find(({ id }) => id === closed.id).state = 'closed';
    draft.feedback.find(({ id }) => id === deferred.id).state = 'deferred';
    draft.changeSets.push({ ...structuredClone(draft.changeSets.find(({ runId }) => runId === cancelledRun.id)),
      id: 'changeset-other-live', runId: null, feedbackIds: [shared.id], status: 'pending' });
  });

  const response = await command(app, `/api/runs/${cancelledRun.id}/cancel`, {}, { branchId: state.currentBranchId });
  assert.equal(response.status, 200);
  const after = await store.read();
  assert.equal(after.runs.find(({ id }) => id === cancelledRun.id).state, 'cancelled');
  assert.equal(after.changeSets.find(({ runId }) => runId === cancelledRun.id).status, 'cancelled');
  assert.equal(after.feedback.find(({ id }) => id === orphan.id).state, 'open');
  assert.equal(after.feedback.find(({ id }) => id === shared.id).state, 'awaiting_decision');
  assert.equal(after.feedback.find(({ id }) => id === closed.id).state, 'closed');
  assert.equal(after.feedback.find(({ id }) => id === deferred.id).state, 'deferred');
});
