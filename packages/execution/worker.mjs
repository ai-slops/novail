import { claimJob, completeJob } from './queue.mjs';
import { GenerationError } from '../../app/errors.mjs';
import { heartbeatJob } from './model-budget.mjs';
import { failureDiagnosticsSchema } from './contracts.ts';

export function createWorker({ store, execute, finalize }) {
  let busy = false;
  let stopped = false;
  let timer;
  const active = new Map();

  async function tick() {
    if (busy || stopped) return;
    busy = true;
    let claim;
    let payload;
    let heartbeat;
    try {
      claim = await claimJob(store);
      if (!claim) return;
      const controller = new AbortController();
      active.set(claim.run.id, controller);
      heartbeat = setInterval(async () => {
        try {
          const renewed = await heartbeatJob(store, { jobId: claim.job.id, leaseToken: claim.job.leaseToken });
          if (!renewed.accepted) controller.abort();
        } catch {
          controller.abort();
        }
      }, 30_000);
      heartbeat.unref();
      payload = await execute({ run: claim.run, job: claim.job, signal: controller.signal });
      await completeJob(store, {
        jobId: claim.job.id, leaseToken: claim.job.leaseToken,
        outputTokens: payload.usageManaged ? 0 : payload.outputTokens ?? payload.estimatedOutputTokens ?? Array.from(payload.text).length,
        usageKnown: typeof payload.outputTokens === 'number',
        usageManaged: payload.usageManaged === true,
        payload, finalize,
      });
    } catch (error) {
      if (!claim) throw error;
      const reportedTokens = payload?.outputTokens ?? (error instanceof GenerationError ? error.outputTokens : undefined);
      const parsedDiagnostics = failureDiagnosticsSchema.safeParse(
        error instanceof GenerationError ? error.diagnostics : undefined,
      );
      const diagnostics = parsedDiagnostics.success ? parsedDiagnostics.data : undefined;
      await completeJob(store, {
        jobId: claim.job.id, leaseToken: claim.job.leaseToken,
        error: { code: error instanceof Error && 'code' in error ? error.code : 'GENERATION_FAILED',
          message: error instanceof Error ? error.message : 'Generation failed.', ...(diagnostics ? { diagnostics } : {}) },
        outputTokens: reportedTokens ?? 0, usageKnown: typeof reportedTokens === 'number',
        usageManaged: error instanceof GenerationError && error.usageManaged,
        releaseReservation: error instanceof GenerationError && !error.invocationStarted,
      });
      if (diagnostics) console.error('worker.generation_failed', JSON.stringify({ runId: claim.run.id, ...diagnostics }));
    } finally {
      clearInterval(heartbeat);
      if (claim) active.delete(claim.run.id);
      busy = false;
    }
  }

  function schedule() {
    if (stopped) return;
    timer = setTimeout(async () => {
      try {
        await tick();
      } catch (error) {
        console.error('worker.persistence_failure', error instanceof Error ? error.message : 'unknown');
      } finally {
        schedule();
      }
    }, 1000);
    timer.unref();
  }

  return {
    tick,
    start() { schedule(); },
    cancel(id) { active.get(id)?.abort(); },
    stop() {
      stopped = true;
      clearTimeout(timer);
      for (const controller of active.values()) controller.abort();
    },
  };
}
