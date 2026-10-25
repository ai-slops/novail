import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSafeDiagnosticLog, diagnosticStageLabel, retryGuidance } from './runtime-diagnostics.ts';

const failedRun = {
  id: 'run-public-42',
  state: 'failed',
  purpose: 'repair_bundle',
  baseSnapshotId: 'snapshot-secret-shape',
  createdAt: '2026-10-17T00:00:00.000Z',
  cancellationRequested: false,
  budget: {
    maxModelCalls: 4,
    maxToolDispatches: 8,
    maxKnownTokens: 64000,
    maxOutputTokens: 16000,
    maxOutputTokensPerInvocation: 4000,
    deadlineSeconds: 120,
  },
  usage: {
    known: false,
    reservedModelCalls: 1,
    reservedOutputTokens: 4000,
    actualKnownTokens: 0,
    actualOutputTokens: 0,
  },
  runtime: {
    name: 'part',
    version: '0.1.0',
    mode: 'openai-compatible',
    modelLabel: 'OpenAI compatible provider',
  },
  selectedModel: 'gpt-6.1-sol',
  error: {
    code: 'GENERATION_FAILED',
    message: 'The selected model cannot use this API capability.',
    diagnostics: {
      stage: 'provider_http',
      providerStatus: 400,
      providerCode: 'unsupported_capability',
      requestId: 'req-safe-123',
      retryable: false,
      reasonCode: 'unsupported_capability',
    },
  },
};

test('safe diagnostic log contains only the support allowlist when a provider run fails', () => {
  // Given: a failed run with provider diagnostics plus sensitive execution inputs nearby
  // When: the UI prepares the copyable support log
  const log = buildSafeDiagnosticLog(failedRun);

  // Then: support identifiers remain while inputs, budgets, and raw messages do not
  assert.deepEqual(log, {
    runId: 'run-public-42',
    state: 'failed',
    model: 'gpt-6.1-sol',
    runtime: { name: 'part', version: '0.1.0', mode: 'openai-compatible' },
    usageKnown: false,
    error: {
      code: 'GENERATION_FAILED',
      stage: 'provider_http',
      providerStatus: 400,
      providerCode: 'unsupported_capability',
      requestId: 'req-safe-123',
      retryable: false,
      reasonCode: 'unsupported_capability',
    },
  });
  assert.equal(JSON.stringify(log).includes('snapshot-secret-shape'), false);
  assert.equal(JSON.stringify(log).includes('cannot use this API capability'), false);
});

test('diagnostic labels explain provider stages and retry policy without provider prose', () => {
  // Given: a typed provider HTTP failure that is not retryable
  // When: human-facing labels are selected
  // Then: the labels explain the stage and next action
  assert.equal(diagnosticStageLabel('provider_http'), 'Provider request rejected');
  assert.equal(retryGuidance(false), 'Retrying with the same settings will not resolve this. Check the model and API protocol configuration.');
});
