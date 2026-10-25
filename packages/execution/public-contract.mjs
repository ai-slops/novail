import { LEGACY_READ_ONLY_TOOL_IDS, PUBLIC_BUDGET_DEFAULTS, PUBLIC_BUDGET_LIMITS, PUBLIC_RUNTIME_EVENT_TYPES,
  READ_ONLY_TOOL_IDS, failureDiagnosticsSchema, runtimeInfoSchema, safeJobSummarySchema, safeRunDetailSchema,
  safeRunSummarySchema } from './contracts.ts';
import { providerConfig } from '../../app/provider-config.mjs';

const legacyEventTypes = new Set([
  'run.queued', 'run.started', 'run.failed', 'run.cancelled', 'run.paused', 'run.resumed',
  'candidate.created', 'decision.required',
]);
const runtimeEventTypes = new Set(PUBLIC_RUNTIME_EVENT_TYPES);
const currentToolIdByLegacyId = new Map(LEGACY_READ_ONLY_TOOL_IDS.map((id, index) => [id, READ_ONLY_TOOL_IDS[index]]));

const safeError = (error) => {
  if (!error || typeof error !== 'object') return undefined;
  const diagnostics = failureDiagnosticsSchema.safeParse(error.diagnostics);
  return { code: typeof error.code === 'string' ? error.code : 'GENERATION_FAILED',
    message: typeof error.message === 'string' ? error.message : 'Generation failed.',
    ...(diagnostics.success ? { diagnostics: diagnostics.data } : {}) };
};

export function safeRunSummary(run) {
  return safeRunSummarySchema.parse({
    id: run.id,
    projectId: run.projectId,
    branchId: run.branchId,
    state: run.state,
    purpose: run.purpose ?? 'legacy',
    baseSnapshotId: run.baseSnapshotId ?? '',
    createdAt: run.createdAt ?? '',
    cancellationRequested: Boolean(run.cancellationRequested),
    budget: run.budget,
    usage: {
      known: run.usageKnown !== false,
      reservedModelCalls: run.reservedCalls ?? 0,
      reservedOutputTokens: run.reservedOutputTokens ?? 0,
      actualKnownTokens: run.actualKnownTokens ?? run.actualOutputTokens ?? 0,
      actualOutputTokens: run.actualOutputTokens ?? 0,
    },
    ...(run.runtime ? { runtime: run.runtime } : {}),
    ...(run.model ? { selectedModel: run.model } : {}),
    ...(run.resultRef ? { resultRef: run.resultRef } : {}),
    ...(run.staleBase !== undefined ? { staleBase: Boolean(run.staleBase) } : {}),
    ...(run.error ? { error: safeError(run.error) } : {}),
  });
}

export function safeJobSummary(job) {
  return safeJobSummarySchema.parse({
    id: job.id,
    runId: job.runId,
    state: job.state,
    attempt: job.attempt ?? 0,
    ...(job.usageState ? { usageState: job.usageState } : {}),
    ...(job.resultRef ? { resultRef: job.resultRef } : {}),
  });
}

export const safeRunDetail = (run, jobs) => safeRunDetailSchema.parse({
  ...safeRunSummary(run),
  jobs: jobs.map(safeJobSummary),
});

function safeRuntimeDetails(event) {
  switch (event.type) {
    case 'runtime.started': return event.details.runtime ? { runtime: event.details.runtime } : {};
    case 'runtime.model.started': return { ordinal: Number(event.details.ordinal) };
    case 'runtime.model.completed': return { ordinal: Number(event.details.ordinal), tokenUsage: event.details.tokenUsage };
    case 'runtime.tool.completed': {
      const toolId = String(event.details.toolId);
      return { toolId: currentToolIdByLegacyId.get(toolId) ?? toolId, outcome: String(event.details.outcome) };
    }
    case 'runtime.text.delta': return { text: String(event.details.text).slice(0, 1024) };
    case 'runtime.progress.gap': return { from: Number(event.details.from), to: Number(event.details.to) };
    case 'runtime.progress.truncated': return { reason: 'public-progress-limit' };
    default: return null;
  }
}

function safeLegacyDetails(event) {
  switch (event.type) {
    case 'run.failed': return safeError(event.details) ?? {};
    case 'candidate.created': return { resultRef: String(event.details.resultRef) };
    case 'run.cancelled': return { externalCallMayStillBeBilled: Boolean(event.details.externalCallMayStillBeBilled) };
    case 'run.queued':
    case 'run.started':
    case 'run.paused':
    case 'run.resumed':
    case 'decision.required': return {};
    default: return null;
  }
}

export function safeRunEvent(event) {
  const details = runtimeEventTypes.has(event.type) ? safeRuntimeDetails(event)
    : legacyEventTypes.has(event.type) ? safeLegacyDetails(event) : null;
  return details === null ? null : {
    id: event.id,
    runId: event.runId,
    sequence: event.sequence,
    type: event.type,
    details,
    createdAt: event.createdAt,
  };
}

export function runtimeInfo() {
  const config = providerConfig();
  const configured = config.mode === 'openai-compatible';
  return runtimeInfoSchema.parse({
    runtime: 'part',
    partVersion: '0.1.0',
    mode: configured ? 'openai-compatible' : 'local-demo',
    nonAI: !configured,
    model: { label: configured
      ? config.model ? `OpenAI-compatible provider · ${config.model}` : 'Select a model to run'
      : 'Local example (not AI) · part fakeModel', defaultModel: config.model },
    publicBudget: { defaults: PUBLIC_BUDGET_DEFAULTS, limits: PUBLIC_BUDGET_LIMITS },
    readOnlyToolIds: READ_ONLY_TOOL_IDS,
  });
}
