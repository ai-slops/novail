import { claimJob, completeJob } from './queue.mjs';

export function createWorker({ store, execute, finalize }) {
  let busy = false;
  let stopped = false;
  let timer;
  const active = new Map();

  async function tick() {
    if (busy || stopped) return;
    busy = true;
    let claim;
    try {
      claim = await claimJob(store);
      if (!claim) return;
      const controller = new AbortController();
      active.set(claim.run.id, controller);
      const payload = await execute({ run: claim.run, signal: controller.signal });
      await completeJob(store, {
        jobId: claim.job.id, leaseToken: claim.job.leaseToken,
        outputTokens: payload.outputTokens ?? Array.from(payload.text).length,
        usageKnown: typeof payload.outputTokens === 'number',
        payload, finalize,
      });
    } catch (error) {
      if (!claim) throw error;
      await completeJob(store, {
        jobId: claim.job.id, leaseToken: claim.job.leaseToken,
        error: { code: error instanceof Error && 'code' in error ? error.code : 'GENERATION_FAILED', message: error instanceof Error ? error.message : '생성 실패' },
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
