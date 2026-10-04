import { addCandidate } from './domain.mjs';
import { generateCandidate } from './gateway.mjs';
import { buildGenerationContext } from './readiness.mjs';
import { createWorker } from '../packages/execution/worker.mjs';
import { assertRecordBranch, mainBranchId } from './branch-state.mjs';

export function createApplicationWorker(store) {
  return createWorker({
    store,
    execute: async ({ run, signal }) => {
      const state = await store.read();
      assertRecordBranch(state, run);
      const context = buildGenerationContext(state, run);
      const generated = await generateCandidate({
        scene: context.scene, instruction: run.instruction, signal,
        maxOutputTokens: Math.max(1, Math.min(4096, run.budget.maxOutputTokens - run.actualOutputTokens)),
        plans: context.plans, reviewExcerpts: context.reviewExcerpts,
      });
      return { ...generated, contextHash: context.contextHash };
    },
    finalize: (state, run, payload) => addCandidate(state, {
      input: { sceneId: run.sceneId, instruction: run.instruction, baseSnapshotId: run.baseSnapshotId, feedbackId: run.feedbackId },
      proposedText: payload.text, adapterLabel: payload.adapterLabel,
      runId: run.id, contextHash: payload.contextHash, contextVersion: run.contextVersion,
      branchId: run.branchId ?? mainBranchId(run.projectId),
    }),
  });
}
