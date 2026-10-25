import { createHash } from 'node:crypto';
import { z } from 'zod';
import { repairRunSchema } from '../packages/revision/contracts.ts';
import { enqueueRun } from '../packages/execution/queue.mjs';
import { branchHeader } from './branch-scope.mjs';
import { DomainError } from './errors.mjs';
import { safeRunSummary } from '../packages/execution/public-contract.mjs';
import { providerConfig } from './provider-config.mjs';

export function mountRepairRoutes(app, { store }) {
  app.post('/api/repair-runs', async (context) => {
    let raw;
    try { raw = await context.req.json(); }
    catch (error) {
      if (error instanceof SyntaxError) throw new DomainError('SCHEMA_INVALID', 'A valid JSON body is required.', 400);
      throw error;
    }
    const input = repairRunSchema.parse(raw);
    const config = providerConfig();
    const model = config.mode === 'openai-compatible' ? input.model ?? config.model : null;
    if (config.mode === 'openai-compatible' && model === null) {
      throw new DomainError('MODEL_REQUIRED', 'Select a model to run.', 422);
    }
    const requestKey = z.uuid().parse(context.req.header('Idempotency-Key'));
    const requestHash = createHash('sha256').update(`${context.req.path}\n${JSON.stringify(input)}`).digest('hex');
    const run = await enqueueRun(store, { ...input, ...(model ? { model, providerApi: config.api } : {}),
      purpose: 'repair_bundle', branchId: context.req.header(branchHeader), requestKey, requestHash });
    return context.json(safeRunSummary(run), 202);
  });
}
