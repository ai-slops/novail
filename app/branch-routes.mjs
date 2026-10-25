import { z } from 'zod';
import { createBranch, switchBranch } from './branches.mjs';
import { branchSummary } from './branch-state.mjs';
import { assertReadScope, branchHeader } from './branch-scope.mjs';
import { DomainError } from './errors.mjs';

const id = z.string().min(1).max(200);
const createSchema = z.strictObject({ name: z.string().trim().min(1).max(80), sourceSnapshotId: id, expectedBranchId: id, expectedHead: id });
const switchSchema = z.strictObject({ expectedBranchId: id, expectedHead: id });

async function parse(context, schema) {
  let body;
  try { body = await context.req.json(); }
  catch (error) {
    if (error instanceof SyntaxError) throw new DomainError('SCHEMA_INVALID', 'A valid JSON body is required.', 400);
    throw error;
  }
  const input = schema.parse(body);
  if (context.req.header(branchHeader) !== input.expectedBranchId) {
    throw new DomainError('BRANCH_MISMATCH', 'The branch header must match the reviewed branch ID.', 409);
  }
  return input;
}

export function mountBranchRoutes(app, { store, command }) {
  app.get('/api/branches', async (context) => {
    const state = await store.read();
    assertReadScope(state, context.req.header(branchHeader));
    return context.json(state.branches.map((branch) => branchSummary(state, branch)));
  });
  app.post('/api/branches', async (context) => {
    const body = await parse(context, createSchema);
    return command(context, { body, status: 201 }, (state) => createBranch(state, body));
  });
  app.post('/api/branches/:id/switch', async (context) => {
    const body = await parse(context, switchSchema);
    return command(context, { body, status: 200 }, (state) => switchBranch(state, context.req.param('id'), body));
  });
}
