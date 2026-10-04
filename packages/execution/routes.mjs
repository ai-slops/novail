import { createHash } from 'node:crypto';
import { z } from 'zod';
import { streamSSE } from 'hono/streaming';
import { enqueueRun, controlRun, RunError } from './queue.mjs';
import { assertReadScope, branchHeader } from '../../app/branch-scope.mjs';
import { assertRecordBranch } from '../../app/branch-state.mjs';
import { DomainError } from '../../app/errors.mjs';

const runSchema = z.strictObject({
  sceneId: z.string().min(1), instruction: z.string().min(1).max(10_000),
  baseSnapshotId: z.string().min(1),
  feedbackId: z.string().min(1).optional(),
  budget: z.strictObject({
    maxModelCalls: z.number().int().min(1).max(12).default(12),
    maxOutputTokens: z.number().int().min(1).max(30_000).default(30_000),
  }).default({ maxModelCalls: 12, maxOutputTokens: 30_000 }),
});

const guarded = (handler) => async (context) => {
  try { return await handler(context); }
  catch (error) {
    if (error instanceof RunError || error instanceof DomainError) return context.json({ error: { code: error.code, message: error.message } }, error.status);
    if (error instanceof z.ZodError) return context.json({ error: { code: 'SCHEMA_INVALID', message: '입력 형식을 확인하세요.', details: error.issues } }, 422);
    if (error instanceof SyntaxError) return context.json({ error: { code: 'SCHEMA_INVALID', message: '유효한 JSON이 필요합니다.' } }, 422);
    throw error;
  }
};

function requestIdentity(context, input) {
  const requestKey = z.uuid().parse(context.req.header('Idempotency-Key'));
  const requestHash = createHash('sha256').update(`${context.req.path}\n${JSON.stringify(input)}`).digest('hex');
  return { requestKey, requestHash, branchId: context.req.header(branchHeader) };
}

export function mountRunRoutes(app, { store, worker }) {
  app.post('/api/runs', guarded(async (context) => {
    const input = runSchema.parse(await context.req.json());
    const run = await enqueueRun(store, { ...input, ...requestIdentity(context, input) });
    return context.json(run, 202);
  }));
  app.get('/api/runs', guarded(async (context) => {
    const state = await store.read();
    assertReadScope(state, context.req.header(branchHeader));
    return context.json(state.runs.filter((run) => run.queueManaged));
  }));
  app.get('/api/runs/:id', guarded(async (context) => {
    const state = await store.read();
    assertReadScope(state, context.req.header(branchHeader));
    const run = state.runs.find((item) => item.id === context.req.param('id') && item.queueManaged);
    if (!run) throw new RunError('NOT_FOUND', '작업을 찾을 수 없습니다.', 404);
    assertRecordBranch(state, run);
    return context.json({ ...run, jobs: (state.jobs ?? []).filter((job) => job.runId === run.id) });
  }));
  app.post('/api/runs/:id/:action', guarded(async (context) => {
    const action = z.enum(['pause', 'resume', 'cancel']).parse(context.req.param('action'));
    z.strictObject({}).parse(await context.req.json());
    const input = { id: context.req.param('id'), action };
    const run = await controlRun(store, { ...input, ...requestIdentity(context, input) });
    if (action === 'cancel') worker.cancel(run.id);
    return context.json(run);
  }));
  app.get('/api/runs/:id/events', guarded(async (context) => {
    const state = await store.read();
    assertReadScope(state, context.req.header(branchHeader));
    const id = context.req.param('id');
    if (!state.runs.some((run) => run.id === id && run.queueManaged)) throw new RunError('NOT_FOUND', '작업을 찾을 수 없습니다.', 404);
    const events = (state.runEvents ?? []).filter((event) => event.runId === id);
    const lastId = context.req.header('Last-Event-ID');
    let cursor = lastId ? events.findIndex((event) => event.id === lastId) : -1;
    if (lastId && cursor < 0) throw new RunError('EVENT_CURSOR_EXPIRED', '작업 상태를 다시 조회하세요.', 409);
    return streamSSE(context, async (stream) => {
      while (!stream.aborted) {
        const latest = await store.read();
        if (latest.project.id !== state.project.id || latest.currentBranchId !== state.currentBranchId) break;
        const runEvents = (latest.runEvents ?? []).filter((event) => event.runId === id);
        for (const event of runEvents.slice(cursor + 1)) {
          await stream.writeSSE({ id: event.id, event: event.type, data: JSON.stringify(event) });
          cursor++;
        }
        const run = latest.runs.find((item) => item.id === id);
        if (!run || ['awaiting_decision', 'completed', 'cancelled', 'failed'].includes(run.state)) break;
        await stream.sleep(1000);
      }
    });
  }));
}
