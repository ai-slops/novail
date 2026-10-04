import assert from 'node:assert/strict';
import test from 'node:test';
import { createSeed } from './seed.mjs';
import { createChangeSet, commitChangeSet } from '../packages/revision/changesets.mjs';
import { workspaceHash } from '../packages/revision/workspace.mjs';

for (const sameDraft of [true, false]) {
  test(sameDraft ? 'adopting a matching draft clears its workspace overlay' : 'adopting another proposal preserves the different human draft', () => {
    const state = createSeed();
    const scene = state.scenes.find((item) => item.id === 'scene-1');
    const after = { ...scene, text: `${scene.text}\n채택한 문장.` };
    const draftText = sameDraft ? after.text : '보존할 별도의 사람 초안';
    state.drafts[scene.id] = { sceneId: scene.id, branchId: state.currentBranchId, text: draftText, baseSnapshotId: state.head };
    const proposal = createChangeSet(state, { kind: 'manual', reason: '초안 채택', changes: [{ kind: 'scene', artifactId: scene.id, after }],
      baseSnapshotId: state.head, baseWorkspaceHash: workspaceHash(state), feedbackIds: [], runId: null,
      candidateId: null, parentChangeSetId: null, merge: null, atomic: false });
    commitChangeSet(state, proposal.id, { expectedHead: state.head, approvedHash: proposal.hash,
      reviewedKeys: proposal.requiredReviewKeys, decision: 'accept', policyVersion: 2 });
    if (sameDraft) assert.equal(state.drafts[scene.id], undefined);
    else assert.equal(state.drafts[scene.id].text, draftText);
  });
}
