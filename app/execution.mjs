import { addCandidate } from './domain.mjs';
import { generateCandidate } from './gateway.mjs';
import { buildGenerationContext } from './readiness.mjs';
import { createWorker } from '../packages/execution/worker.mjs';
import { assertRecordBranch, mainBranchId } from './branch-state.mjs';
import { generateRepair } from './repair-generation.mjs';
import { workspaceHash } from '../packages/revision/workspace.mjs';
import { createChangeSet } from '../packages/revision/changesets.mjs';
import { GenerationError } from './errors.mjs';

export function createApplicationWorker(store) {
  return createWorker({
    store,
    execute: async ({ run, job, signal }) => {
      const state = await store.read();
      assertRecordBranch(state, run);
      if (run.purpose === 'repair_bundle') {
        if (workspaceHash(run.inputWorkspace) !== run.baseWorkspaceHash) {
          throw new GenerationError('RUN_INPUT_INVALID', '고정된 개정 입력의 해시가 일치하지 않습니다.', { status: 409, outputTokens: 0, invocationStarted: false });
        }
        if (state.head !== run.baseSnapshotId || workspaceHash(state) !== run.baseWorkspaceHash) {
          throw new GenerationError('STALE_WORKSPACE', '실행 전에 원고 또는 기획이 바뀌었습니다. 새 개정 요청을 만드세요.', { status: 409, outputTokens: 0, invocationStarted: false });
        }
        return generateRepair({ run, job, store, signal });
      }
      const context = buildGenerationContext(state, run);
      const generated = await generateCandidate({
        scene: context.scene, instruction: run.instruction, signal,
        maxOutputTokens: Math.max(1, Math.min(4096, run.budget.maxOutputTokens - run.actualOutputTokens)),
        plans: context.plans, reviewExcerpts: context.reviewExcerpts,
      });
      return { ...generated, contextHash: context.contextHash };
    },
    finalize: (state, run, payload) => {
      if (run.purpose === 'repair_bundle') {
        const changes = [
          ...payload.patches.scenes.map((patch) => ({ kind: 'scene', artifactId: patch.id,
            after: { ...run.inputWorkspace.scenes.find((scene) => scene.id === patch.id), text: patch.text } })),
          ...payload.patches.plans.map((patch) => ({ kind: 'plan', artifactId: patch.id,
            after: { ...run.inputWorkspace.plans.find((plan) => plan.id === patch.id), description: patch.description } })),
        ];
        return createChangeSet(state, { kind: 'repair', reason: `${run.instruction} (${payload.adapterLabel})`, changes,
          baseSnapshotId: run.baseSnapshotId, baseWorkspaceHash: run.baseWorkspaceHash, baseWorkspace: run.inputWorkspace,
          baseContextVersion: run.contextVersion, feedbackIds: run.feedbackIds, runId: run.id,
          candidateId: null, parentChangeSetId: null, atomic: false, merge: null });
      }
      return addCandidate(state, {
        input: { sceneId: run.sceneId, instruction: run.instruction, baseSnapshotId: run.baseSnapshotId, feedbackId: run.feedbackId },
        proposedText: payload.text, adapterLabel: payload.adapterLabel,
        runId: run.id, contextHash: payload.contextHash, contextVersion: run.contextVersion,
        branchId: run.branchId ?? mainBranchId(run.projectId),
      });
    },
  });
}
