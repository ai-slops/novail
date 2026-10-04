import { createHash } from 'node:crypto';
import { z } from 'zod';
import { DomainError } from './errors.mjs';
import { assertActiveScope, assertReplayScope, branchHeader, resolveBranchScope } from './branch-scope.mjs';

function replayRecord(state, request) {
  const existing = state.idempotency[request.key];
  if (!existing) return null;
  if (existing.hash !== request.hash) throw new DomainError('IDEMPOTENCY_MISMATCH', '같은 키가 다른 요청에 사용되었습니다.', 409);
  assertReplayScope(state, existing, request.scope);
  return existing;
}

export async function prepareCommand(store, context, input) {
  const key = z.uuid().safeParse(context.req.header('Idempotency-Key'));
  if (!key.success) throw new DomainError('IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key UUID가 필요합니다.', 400);
  const state = await store.read();
  const scope = resolveBranchScope(state, context.req.header(branchHeader));
  const request = { key: key.data, scope, hash: createHash('sha256').update(`${context.req.path}\n${JSON.stringify(input.body)}`).digest('hex') };
  const replay = replayRecord(state, request);
  if (!replay) assertActiveScope(state, scope);
  return { ...request, state, replay };
}

export function createCommandHandler(store) {
  return async (context, input, operation) => {
    const request = await prepareCommand(store, context, input);
    if (request.replay) return context.json(request.replay.result, request.replay.status);
    const completed = await store.transaction(async (state) => {
      const replay = replayRecord(state, request);
      if (replay) return replay;
      assertActiveScope(state, request.scope);
      const result = await operation(state);
      const record = { hash: request.hash, status: input.status, result: structuredClone(result),
        projectId: request.scope.projectId, branchId: request.scope.branchId, scopeExplicit: request.scope.explicit };
      state.idempotency[request.key] = record;
      return record;
    });
    return context.json(completed.result, completed.status);
  };
}
