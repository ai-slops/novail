import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Hono } from 'hono';
import { z } from 'zod';

import { createBranch } from './branches.mjs';
import { createCommandHandler } from './commands.mjs';
import { DomainError } from './errors.mjs';
import { mountMergeRoutes } from './merge-routes.mjs';
import { FileStore } from './store.mjs';
import { workspaceHash } from '../packages/revision/workspace.mjs';

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'novail-merges-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = new FileStore(join(directory, 'state.json'));
  await store.initialize();
  const source = await store.transaction((state) => {
    const branch = createBranch(state, { name: 'Source', sourceSnapshotId: state.head, expectedBranchId: state.currentBranchId, expectedHead: state.head });
    const stored = state.branches.find(({ id }) => id === branch.id);
    stored.workspace.scenes[0].text += '\nsource change';
    return branch;
  });
  const app = new Hono();
  app.onError((error, context) => {
    if (error instanceof DomainError) return context.json({ error: { code: error.code } }, error.status);
    if (error instanceof z.ZodError) return context.json({ error: { code: 'SCHEMA_INVALID' } }, 400);
    throw error;
  });
  mountMergeRoutes(app, { store, command: createCommandHandler(store) });
  return { app, source, store };
}

const post = (app, path, body, branchId) => app.request(path, {
  method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': randomUUID(), 'X-Novail-Branch-Id': branchId },
  body: JSON.stringify(body),
});

test('Given an inactive source branch, when previewed, read, and sealed, then routes return schema-safe immutable resources', async (t) => {
  const { app, source, store } = await fixture(t);
  const state = await store.read();
  const created = await post(app, '/api/merge-previews', {
    sourceBranchId: source.id, expectedHead: state.head, baseWorkspaceHash: workspaceHash(state),
  }, state.currentBranchId);
  const preview = await created.json();

  const read = await app.request(`/api/merge-previews/${preview.id}`, { headers: { 'X-Novail-Branch-Id': state.currentBranchId } });
  const sealed = await post(app, `/api/merge-previews/${preview.id}/seal`, { previewHash: preview.hash, resolutions: [] }, state.currentBranchId);
  const changeSet = await sealed.json();

  assert.equal(created.status, 201);
  assert.equal(read.status, 200);
  assert.equal(sealed.status, 201);
  assert.equal(changeSet.kind, 'merge');
  assert.equal(changeSet.merge.previewId, preview.id);
});

test('Given a preview, when the source workspace changes before sealing, then the seal route rejects it as stale', async (t) => {
  const { app, source, store } = await fixture(t);
  const state = await store.read();
  const preview = await (await post(app, '/api/merge-previews', {
    sourceBranchId: source.id, expectedHead: state.head, baseWorkspaceHash: workspaceHash(state),
  }, state.currentBranchId)).json();
  await store.transaction((next) => { next.branches.find(({ id }) => id === source.id).workspace.plans[0].description += ' changed'; });

  const response = await post(app, `/api/merge-previews/${preview.id}/seal`, { previewHash: preview.hash, resolutions: [] }, state.currentBranchId);

  assert.equal(response.status, 409);
  assert.equal((await response.json()).error.code, 'MERGE_PREVIEW_STALE');
});
