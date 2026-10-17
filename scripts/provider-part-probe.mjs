import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApplicationWorker } from '../app/execution.mjs';
import { FileStore } from '../app/store.mjs';
import { workspaceHash } from '../packages/revision/workspace.mjs';
import { enqueueRun } from '../packages/execution/queue.mjs';
import { READ_ONLY_TOOL_IDS } from '../packages/execution/contracts.ts';

export class PartProbeError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'PartProbeError';
    this.code = code;
  }
}

export async function runPartProbe() {
  const directory = await mkdtemp(join(tmpdir(), 'novail-provider-'));
  const store = new FileStore(join(directory, 'state.json'));
  let worker;
  try {
    await store.initialize();
    const before = await store.read();
    const queued = await enqueueRun(store, {
      branchId: before.currentBranchId,
      purpose: 'repair_bundle',
      baseSnapshotId: before.head,
      baseWorkspaceHash: workspaceHash(before),
      instruction: 'Use every available NOVAIL read-only tool, then return complete unchanged selected artifacts for this connectivity test.',
      sceneIds: ['scene-1'],
      planIds: ['plan-plot'],
      feedbackIds: [],
      budget: { maxModelCalls: 3, maxToolDispatches: 3, maxKnownTokens: 8_192,
        maxOutputTokens: 2_048, maxOutputTokensPerInvocation: 1_024, deadlineSeconds: 60 },
    });
    worker = createApplicationWorker(store);
    await worker.tick();
    const after = await store.read();
    const run = after.runs.find(({ id }) => id === queued.id);
    if (!run || run.state !== 'awaiting_decision') {
      const code = run?.error?.code ?? 'PART_INTEGRATION_FAILED';
      throw new PartProbeError(code, 'NOVAIL Part did not produce an awaiting-decision result. Check route model and schema support.');
    }
    if (run.runtime?.mode !== 'openai-compatible' || run.runtime?.name !== 'part') {
      throw new PartProbeError('DEMO_MODE_DETECTED', 'The probe entered local demo mode instead of the configured provider path.');
    }
    if (after.head !== before.head) throw new PartProbeError('HEAD_CHANGED', 'The isolated probe unexpectedly changed its canonical head.');
    const result = after.changeSets?.find(({ id }) => id === run.resultRef);
    if (!result || result.status !== 'pending' || result.runId !== run.id || !result.reason.includes(run.runtime.modelLabel)) {
      throw new PartProbeError('RESULT_INVALID', 'The probe result is missing pending-review state or Part provenance.');
    }
    const exercised = new Set((after.runEvents ?? []).filter((event) => event.runId === run.id
      && event.type === 'runtime.tool.completed' && event.details.outcome === 'completed').map((event) => event.details.toolId));
    if (!READ_ONLY_TOOL_IDS.every((id) => exercised.has(id))) {
      throw new PartProbeError('TOOLS_NOT_EXERCISED', `Tool compatibility is unverified: exercised ${exercised.size} of ${READ_ONLY_TOOL_IDS.length} read-only tools.`);
    }
    return Object.freeze({ toolsExercised: exercised.size, headUnchanged: true,
      resultState: result.status, reservedModelCalls: run.reservedCalls,
      actualKnownTokens: run.actualKnownTokens, actualOutputTokens: run.actualOutputTokens });
  } finally {
    worker?.stop();
    await store.close();
    await rm(directory, { recursive: true, force: true });
  }
}
