import { randomUUID } from 'node:crypto';
import { isActiveRecord } from '../../app/branch-state.mjs';
import { PUBLIC_RUNTIME_EVENT_TYPES } from './contracts.ts';

const publicTypes = new Set(PUBLIC_RUNTIME_EVENT_TYPES);
const progressTypes = new Set(['runtime.text.delta', 'runtime.progress.gap']);

export async function appendRuntimeEvent(store, input) {
  return store.transaction((state) => {
    if (!publicTypes.has(input.type)) return { accepted: false };
    const job = (state.jobs ?? []).find((item) => item.id === input.jobId);
    const run = job && state.runs.find((item) => item.id === job.runId);
    if (!job || !run || job.leaseToken !== input.leaseToken || !isActiveRecord(state, run)) return { accepted: false };
    if (input.type === 'runtime.started') run.runtime = structuredClone(input.details.runtime);
    const events = (state.runEvents ??= []);
    const progress = events.filter((event) => event.runId === run.id && progressTypes.has(event.type));
    const bytes = progress.reduce((total, event) => total + Buffer.byteLength(JSON.stringify(event.details)), 0);
    const nextBytes = Buffer.byteLength(JSON.stringify(input.details));
    if (progressTypes.has(input.type) && (progress.length >= 128 || bytes + nextBytes > 64 * 1024)) {
      if (!events.some((event) => event.runId === run.id && event.type === 'runtime.progress.truncated')) {
        events.push({ id: randomUUID(), runId: run.id,
          sequence: events.filter((event) => event.runId === run.id).length + 1,
          type: 'runtime.progress.truncated', details: { reason: 'public-progress-limit' }, createdAt: new Date().toISOString() });
      }
      return { accepted: false };
    }
    events.push({ id: randomUUID(), runId: run.id,
      sequence: events.filter((event) => event.runId === run.id).length + 1,
      type: input.type, details: input.details, createdAt: new Date().toISOString() });
    return { accepted: true };
  });
}

export function createProgressRecorder(store, lease) {
  let text = '';
  let timer;
  let pending = Promise.resolve();
  const persist = (type, details) => {
    pending = pending.then(() => appendRuntimeEvent(store, { ...lease, type, details }));
  };
  const flush = () => {
    clearTimeout(timer);
    timer = undefined;
    while (text.length) {
      const chunk = text.slice(0, 1024);
      text = text.slice(chunk.length);
      persist('runtime.text.delta', { text: chunk });
    }
  };
  return {
    record(update) {
      if (update.kind === 'gap') {
        persist('runtime.progress.gap', { from: update.from, to: update.to });
        return;
      }
      if (update.type !== 'text-delta' || typeof update.payload?.text !== 'string') return;
      text += update.payload.text;
      if (text.length >= 1024) flush();
      else if (!timer) {
        timer = setTimeout(flush, 200);
        timer.unref();
      }
    },
    async close() {
      flush();
      await pending;
    },
  };
}
