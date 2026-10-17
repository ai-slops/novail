import { z } from 'zod';

export const PUBLIC_BUDGET_DEFAULTS = Object.freeze({
  maxModelCalls: 4,
  maxToolDispatches: 8,
  maxKnownTokens: 64_000,
  maxOutputTokens: 16_000,
  maxOutputTokensPerInvocation: 4_000,
  deadlineSeconds: 120,
});

export const PUBLIC_BUDGET_LIMITS = Object.freeze({
  maxModelCalls: Object.freeze({ min: 1, max: 12 }),
  maxToolDispatches: Object.freeze({ min: 1, max: 24 }),
  maxKnownTokens: Object.freeze({ min: 1, max: 1_000_000 }),
  maxOutputTokens: Object.freeze({ min: 1, max: 30_000 }),
  maxOutputTokensPerInvocation: Object.freeze({ min: 1, max: 16_000 }),
  deadlineSeconds: Object.freeze({ min: 30, max: 300 }),
});

const completeBudgetSchema = z.strictObject({
  maxModelCalls: z.number().int().min(1).max(12),
  maxToolDispatches: z.number().int().min(1).max(24),
  maxKnownTokens: z.number().int().positive().max(1_000_000),
  maxOutputTokens: z.number().int().min(1).max(30_000),
  maxOutputTokensPerInvocation: z.number().int().min(1).max(16_000),
  deadlineSeconds: z.number().int().min(30).max(300),
}).superRefine((budget, context) => {
  if (budget.maxKnownTokens < budget.maxOutputTokens) {
    context.addIssue({ code: 'custom', message: 'maxKnownTokens must cover maxOutputTokens', path: ['maxKnownTokens'] });
  }
  if (budget.maxOutputTokensPerInvocation > budget.maxOutputTokens) {
    context.addIssue({ code: 'custom', message: 'per-invocation output must fit the total output budget', path: ['maxOutputTokensPerInvocation'] });
  }
});

export const executionBudgetSchema = z.preprocess((value) => {
  if (value === undefined) return PUBLIC_BUDGET_DEFAULTS;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return value;
  const maxOutputTokens = 'maxOutputTokens' in value && typeof value.maxOutputTokens === 'number'
    ? value.maxOutputTokens
    : PUBLIC_BUDGET_DEFAULTS.maxOutputTokens;
  return {
    ...value,
    maxModelCalls: 'maxModelCalls' in value ? value.maxModelCalls : PUBLIC_BUDGET_DEFAULTS.maxModelCalls,
    maxToolDispatches: 'maxToolDispatches' in value ? value.maxToolDispatches : PUBLIC_BUDGET_DEFAULTS.maxToolDispatches,
    maxKnownTokens: 'maxKnownTokens' in value ? value.maxKnownTokens : Math.max(PUBLIC_BUDGET_DEFAULTS.maxKnownTokens, maxOutputTokens),
    maxOutputTokens,
    maxOutputTokensPerInvocation: 'maxOutputTokensPerInvocation' in value
      ? value.maxOutputTokensPerInvocation
      : Math.min(PUBLIC_BUDGET_DEFAULTS.maxOutputTokensPerInvocation, maxOutputTokens),
    deadlineSeconds: 'deadlineSeconds' in value ? value.deadlineSeconds : PUBLIC_BUDGET_DEFAULTS.deadlineSeconds,
  };
}, completeBudgetSchema);

export const READ_ONLY_TOOL_IDS = Object.freeze([
  'novail_read_selected_scenes',
  'novail_read_selected_plans',
  'novail_read_readonly_context',
] as const);

export const LEGACY_READ_ONLY_TOOL_IDS = Object.freeze([
  'novail.read_selected_scenes',
  'novail.read_selected_plans',
  'novail.read_readonly_context',
] as const);

export const PUBLIC_RUNTIME_EVENT_TYPES = Object.freeze([
  'runtime.started',
  'runtime.model.started',
  'runtime.model.completed',
  'runtime.tool.completed',
  'runtime.text.delta',
  'runtime.progress.gap',
  'runtime.progress.truncated',
] as const);

const publicErrorSchema = z.strictObject({ code: z.string(), message: z.string() });
const publicUsageSchema = z.strictObject({
  reservedModelCalls: z.number().int().nonnegative(),
  reservedOutputTokens: z.number().int().nonnegative(),
  actualKnownTokens: z.number().int().nonnegative(),
  actualOutputTokens: z.number().int().nonnegative(),
});
export const runRuntimeSchema = z.strictObject({
  name: z.literal('part'),
  version: z.literal('0.1.0'),
  mode: z.enum(['local-demo', 'openai-compatible']),
  modelLabel: z.string(),
});

export const safeRunSummarySchema = z.strictObject({
  id: z.string(),
  projectId: z.string().optional(),
  branchId: z.string().optional(),
  state: z.string(),
  purpose: z.string(),
  baseSnapshotId: z.string(),
  createdAt: z.string(),
  cancellationRequested: z.boolean(),
  budget: executionBudgetSchema,
  usage: publicUsageSchema,
  runtime: runRuntimeSchema.optional(),
  resultRef: z.string().optional(),
  staleBase: z.boolean().optional(),
  error: publicErrorSchema.optional(),
});

export const safeJobSummarySchema = z.strictObject({
  id: z.string(),
  runId: z.string(),
  state: z.string(),
  attempt: z.number().int().nonnegative(),
  usageState: z.string().optional(),
  resultRef: z.string().optional(),
});

export const safeRunDetailSchema = safeRunSummarySchema.extend({
  jobs: z.array(safeJobSummarySchema),
});

const runtimeEventEnvelope = {
  id: z.string(), runId: z.string(), sequence: z.number().int().positive(), createdAt: z.string(),
};
export const publicRuntimeEventSchema = z.discriminatedUnion('type', [
  z.strictObject({ ...runtimeEventEnvelope, type: z.literal('runtime.started'),
    details: z.strictObject({ runtime: runRuntimeSchema.optional() }) }),
  z.strictObject({ ...runtimeEventEnvelope, type: z.literal('runtime.model.started'),
    details: z.strictObject({ ordinal: z.number().int().positive() }) }),
  z.strictObject({ ...runtimeEventEnvelope, type: z.literal('runtime.model.completed'),
    details: z.strictObject({ ordinal: z.number().int().positive(), tokenUsage: z.strictObject({
      inputTokens: z.number().int().nonnegative().nullable(), outputTokens: z.number().int().nonnegative(),
      basis: z.enum(['estimated', 'provider-reported']),
    }) }) }),
  z.strictObject({ ...runtimeEventEnvelope, type: z.literal('runtime.tool.completed'),
    details: z.strictObject({ toolId: z.union([z.enum(READ_ONLY_TOOL_IDS), z.enum(LEGACY_READ_ONLY_TOOL_IDS)]),
      outcome: z.enum(['completed', 'failed', 'cancelled']) }) }),
  z.strictObject({ ...runtimeEventEnvelope, type: z.literal('runtime.text.delta'),
    details: z.strictObject({ text: z.string().max(1024) }) }),
  z.strictObject({ ...runtimeEventEnvelope, type: z.literal('runtime.progress.gap'),
    details: z.strictObject({ from: z.number().int().nonnegative(), to: z.number().int().nonnegative() }) }),
  z.strictObject({ ...runtimeEventEnvelope, type: z.literal('runtime.progress.truncated'),
    details: z.strictObject({ reason: z.literal('public-progress-limit') }) }),
]);

export const runtimeInfoSchema = z.strictObject({
  runtime: z.literal('part'),
  partVersion: z.literal('0.1.0'),
  mode: z.enum(['local-demo', 'openai-compatible']),
  nonAI: z.boolean(),
  model: z.strictObject({ label: z.string() }),
  publicBudget: z.strictObject({
    defaults: completeBudgetSchema,
    limits: z.record(z.string(), z.strictObject({ min: z.number(), max: z.number() })),
  }),
  readOnlyToolIds: z.tuple([
    z.literal('novail_read_selected_scenes'),
    z.literal('novail_read_selected_plans'),
    z.literal('novail_read_readonly_context'),
  ]),
});

export type ExecutionBudget = z.infer<typeof executionBudgetSchema>;
export type SafeRunSummary = z.infer<typeof safeRunSummarySchema>;
export type SafeRunDetail = z.infer<typeof safeRunDetailSchema>;
export type PublicRuntimeEvent = z.infer<typeof publicRuntimeEventSchema>;
export type RuntimeInfo = z.infer<typeof runtimeInfoSchema>;
