import { claimJob, completeJob } from './queue.mjs';
import { GenerationError } from '../../app/errors.mjs';

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
    try {
      claim = await claimJob(store);
      if (!claim) return;
      const controller = new AbortController();
      active.set(claim.run.id, controller);
      payload = await execute({ run: claim.run, signal: controller.signal });
      await completeJob(store, {
        jobId: claim.job.id, leaseToken: claim.job.leaseToken,
        outputTokens: payload.outputTokens ?? payload.estimatedOutputTokens ?? Array.from(payload.text).length,
        usageKnown: typeof payload.outputTokens === 'number',
        payload, finalize,
      });
    } catch (error) {
      if (!claim) throw error;
      const reportedTokens = payload?.outputTokens ?? (error instanceof GenerationError ? error.outputTokens : undefined);
      await completeJob(store, {
        jobId: claim.job.id, leaseToken: claim.job.leaseToken,
        error: { code: error instanceof Error && 'code' in error ? error.code : 'GENERATION_FAILED', message: error instanceof Error ? error.message : '생성 실패' },
        outputTokens: reportedTokens ?? 0, usageKnown: typeof reportedTokens === 'number',
        releaseReservation: error instanceof GenerationError && !error.invocationStarted,
      });
    } finally {
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
