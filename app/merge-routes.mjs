import { z } from 'zod';
import { changeSetSchema, hashSchema, idSchema, mergePreviewSchema, sealMergeSchema } from '../packages/revision/contracts.ts';
import { createMergePreview, getMergePreview, sealMergePreview } from '../packages/revision/merges.mjs';
import { assertReadScope, branchHeader } from './branch-scope.mjs';
import { DomainError } from './errors.mjs';

const createPreviewSchema = z.strictObject({
  sourceBranchId: idSchema, expectedHead: idSchema, baseWorkspaceHash: hashSchema,
});

async function body(context, schema) {
  let value;
  try {
    value = await context.req.json();
  } catch (error) {
    if (error instanceof SyntaxError) throw new DomainError('SCHEMA_INVALID', 'A valid JSON body is required.', 400);
    throw error;
  }
  return schema.parse(value);
}

export function mountMergeRoutes(app, { store, command }) {
  app.post('/api/merge-previews', async (context) => {
    const input = await body(context, createPreviewSchema);
    return command(context, { body: input, status: 201 }, (state) => mergePreviewSchema.parse(createMergePreview(state, input)));
  });
  app.get('/api/merge-previews/:id', async (context) => {
    const state = await store.read();
    assertReadScope(state, context.req.header(branchHeader));
    return context.json(mergePreviewSchema.parse(getMergePreview(state, context.req.param('id'))));
  });
  app.post('/api/merge-previews/:id/seal', async (context) => {
    const input = await body(context, sealMergeSchema);
    return command(context, { body: input, status: 201 }, (state) => (
      changeSetSchema.parse(sealMergePreview(state, context.req.param('id'), input))
    ));
  });
}
